/**
 * Scan Orchestrator — sequential module execution with error isolation,
 * per-module timeouts, and progress tracking.
 *
 * Requirements: 4.3, 4.5, 4.6, 4.8, 4.9, 4.12
 */

import { Knex } from 'knex';
import db from '../db';
import { logEvent } from '../utils/activityLog';
import { ensureOwaspCategoryCompleteness } from './owaspService';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ScanContext {
  scanId: string;
  targetUrl: string;
  siteMap?: unknown;
  db: Knex;
  logger: typeof console;
}

export interface ModuleResult {
  status: 'completed' | 'failed' | 'timed_out';
  findings: unknown[];
  duration: number;
}

export interface ScanModule {
  name: string;
  execute(ctx: ScanContext): Promise<ModuleResult>;
  /** Timeout in seconds. Defaults to 300. */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Module registry
// ---------------------------------------------------------------------------

/**
 * Global module registry.
 * Scan modules (tasks 9–17) register themselves here via registerModule().
 */
export const moduleRegistry = new Map<string, ScanModule>();

export function registerModule(mod: ScanModule): void {
  moduleRegistry.set(mod.name, mod);
}

// ---------------------------------------------------------------------------
// Stop-request set (in-memory flag)
// ---------------------------------------------------------------------------

/**
 * Scan IDs for which a stop has been requested.
 * The orchestrator polls this set between modules.
 */
const stopRequestedSet = new Set<string>();

export function requestStop(scanId: string): void {
  stopRequestedSet.add(scanId);
}

export function clearStopRequest(scanId: string): void {
  stopRequestedSet.delete(scanId);
}

export function isStopRequested(scanId: string): boolean {
  return stopRequestedSet.has(scanId);
}

// ---------------------------------------------------------------------------
// Progress interval helper
// ---------------------------------------------------------------------------

const DEFAULT_MODULE_TIMEOUT_SECONDS = 300;
const PROGRESS_INTERVAL_MS = 10_000; // 10 seconds

/**
 * Starts a setInterval that writes the current progress_pct to the DB
 * every 10 seconds while the scan is running.
 *
 * Returns a function that stops the interval and performs a final DB write.
 */
function startProgressInterval(
  scanId: string,
  getProgress: () => number,
): () => Promise<void> {
  const handle = setInterval(async () => {
    try {
      await db('scans')
        .where({ id: scanId })
        .update({ progress_pct: getProgress() });
    } catch (err) {
      console.error(`[scanOrchestrator] Failed to update progress for scan ${scanId}:`, err);
    }
  }, PROGRESS_INTERVAL_MS);

  return async () => {
    clearInterval(handle);
    // Final progress write
    try {
      await db('scans')
        .where({ id: scanId })
        .update({ progress_pct: getProgress() });
    } catch (err) {
      console.error(`[scanOrchestrator] Failed final progress update for scan ${scanId}:`, err);
    }
  };
}

// ---------------------------------------------------------------------------
// Core orchestrator
// ---------------------------------------------------------------------------

/**
 * Executes all selected scan modules sequentially with error isolation.
 *
 * - Each module is raced against a per-module timeout (default 300 s).
 * - A failed or timed-out module does NOT stop the scan; execution continues.
 * - Progress is written to the DB every 10 s via setInterval.
 * - The orchestrator checks stopRequestedSet between modules.
 * - Final status:
 *   - All modules failed/timed_out → "failed"
 *   - Otherwise → "completed"
 *
 * Requirements: 4.5, 4.8, 4.9, 4.12
 */
export async function runScan(
  scanId: string,
  targetUrl: string,
  modules: ScanModule[],
  userId: string,
): Promise<void> {
  const totalModules = modules.length;
  let completedCount = 0;

  const getProgress = (): number =>
    totalModules === 0 ? 100 : Math.round((completedCount / totalModules) * 100);

  const stopProgressInterval = startProgressInterval(scanId, getProgress);

  const ctx: ScanContext = {
    scanId,
    targetUrl,
    db,
    logger: console,
  };

  let anySucceeded = false;

  try {
    for (const mod of modules) {
      // Check stop request before each module
      if (isStopRequested(scanId)) {
        break;
      }

      const timeoutMs = (mod.timeout ?? DEFAULT_MODULE_TIMEOUT_SECONDS) * 1000;
      const startTime = Date.now();

      // Mark module as running
      await db('scan_modules')
        .where({ scan_id: scanId, module_name: mod.name })
        .update({ status: 'running', started_at: new Date() });

      let moduleResult: ModuleResult;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('MODULE_TIMEOUT')), timeoutMs);
        });

        const execResult = await Promise.race([mod.execute(ctx), timeoutPromise]);
        moduleResult = execResult;
      } catch (err) {
        const isTimeout = err instanceof Error && err.message === 'MODULE_TIMEOUT';
        const duration = Date.now() - startTime;

        moduleResult = {
          status: isTimeout ? 'timed_out' : 'failed',
          findings: [],
          duration,
        };

        const errorMsg = isTimeout
          ? `Module timed out after ${mod.timeout ?? DEFAULT_MODULE_TIMEOUT_SECONDS}s`
          : (err instanceof Error ? err.message : String(err));

        await db('scan_modules')
          .where({ scan_id: scanId, module_name: mod.name })
          .update({
            status: moduleResult.status,
            completed_at: new Date(),
            error_message: errorMsg,
          });

        await logEvent({
          eventType: 'scan_module_error',
          actorUserId: userId,
          targetResourceId: scanId,
          targetResourceType: 'scan',
          description: `Module "${mod.name}" ${moduleResult.status}: ${errorMsg}`,
        });

        completedCount++;
        continue;
      }

      // Successful module execution
      await db('scan_modules')
        .where({ scan_id: scanId, module_name: mod.name })
        .update({
          status: moduleResult.status,
          completed_at: new Date(),
          error_message: null,
        });

      // Attach siteMap from crawler module result to context for downstream use
      if (mod.name === 'crawler' && moduleResult.status === 'completed') {
        const siteMapResult = moduleResult.findings[0];
        if (siteMapResult !== undefined) {
          ctx.siteMap = siteMapResult;
        }
      }

      if (moduleResult.status === 'completed') {
        anySucceeded = true;
      }

      completedCount++;
    }

    // Determine final scan status
    const wasStopped = isStopRequested(scanId);
    clearStopRequest(scanId);

    if (wasStopped) {
      await db('scans')
        .where({ id: scanId })
        .update({ status: 'stopped', completed_at: new Date() });

      await logEvent({
        eventType: 'scan_stop',
        actorUserId: userId,
        targetResourceId: scanId,
        targetResourceType: 'scan',
        description: `Scan stopped by user request.`,
      });

      return;
    }

    // Check if all modules failed
    const allFailed = !anySucceeded && modules.length > 0;
    const finalStatus = allFailed ? 'failed' : 'completed';

    // Ensure every vulnerability has an OWASP category (Requirement 14.1, 14.3)
    try {
      await ensureOwaspCategoryCompleteness(scanId, db);
    } catch (err) {
      console.error(`[scanOrchestrator] ensureOwaspCategoryCompleteness failed for scan ${scanId}:`, err);
    }

    await db('scans')
      .where({ id: scanId })
      .update({ status: finalStatus, completed_at: new Date(), progress_pct: 100 });

    await logEvent({
      eventType: 'scan_completion',
      actorUserId: userId,
      targetResourceId: scanId,
      targetResourceType: 'scan',
      description: `Scan ${finalStatus}.`,
    });
  } finally {
    await stopProgressInterval();
  }
}
