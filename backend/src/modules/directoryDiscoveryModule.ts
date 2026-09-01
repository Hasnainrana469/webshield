/**
 * DirectoryDiscoveryModule — probes a predefined list of paths for exposed
 * directories and sensitive files using HEAD requests.
 *
 * Risk assignment:
 *  - Sensitive file (/.env, /.git/config, *.sql, *.bak, *.old) + HTTP 200 → Critical
 *  - Any path returning HTTP 200 or 403 → Low (unless overridden to Critical above)
 *
 * Uses node-fetch (ESM) via dynamic import for CJS compatibility.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 * OWASP: A05:2021 – Security Misconfiguration
 */

import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const OWASP_CATEGORY = 'A05:2021 – Security Misconfiguration';

// ---------------------------------------------------------------------------
// Probe list (Requirement 11.1)
// ---------------------------------------------------------------------------

const PROBE_PATHS: string[] = [
  '/admin',
  '/wp-admin',
  '/.env',
  '/.git/config',
  '/backup',
  '/config',
  '/robots.txt',
  '/sitemap.xml',
  '/backup.sql',
  '/backup.bak',
  '/config.bak',
  '/database.sql',
  '/db.sql',
  '/.htaccess',
  '/phpinfo.php',
];

// ---------------------------------------------------------------------------
// Sensitive path detection (Requirement 11.3)
// ---------------------------------------------------------------------------

/**
 * Returns true when the path represents a sensitive file that should be
 * treated as Critical (vs Low) when accessible.
 *
 * Sensitive set: /.env, /.git/config, *.sql, *.bak, *.old
 */
function isSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower === '/.env' ||
    lower === '/.git/config' ||
    lower.endsWith('.sql') ||
    lower.endsWith('.bak') ||
    lower.endsWith('.old')
  );
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class DirectoryDiscoveryModule implements ScanModule {
  readonly name = 'directory_discovery';
  readonly timeout = 60; // seconds

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];

    const { scanId, targetUrl, db, logger } = ctx;

    logger.log(`[DirectoryDiscoveryModule] Starting directory discovery for ${targetUrl}`);

    // Dynamically import ESM node-fetch in this CJS project
    let fetchFn: typeof import('node-fetch').default;
    try {
      const mod = await import('node-fetch') as { default: typeof import('node-fetch').default };
      fetchFn = mod.default;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[DirectoryDiscoveryModule] Failed to import node-fetch: ${msg}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    // Normalise base URL (strip trailing slash)
    let baseUrl: string;
    try {
      const parsed = new URL(targetUrl);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    } catch {
      logger.error(`[DirectoryDiscoveryModule] Invalid target URL: ${targetUrl}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    for (const path of PROBE_PATHS) {
      const probeUrl = `${baseUrl}${path}`;

      let statusCode: number | null = null;

      try {
        const response = await fetchFn(probeUrl, {
          method: 'HEAD',
          redirect: 'follow',
          // 10 second per-request timeout via AbortController
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = response.status;
      } catch (err) {
        // Network error, ECONNREFUSED, timeout, etc. — skip path
        const msg = err instanceof Error ? err.message : String(err);
        logger.log(`[DirectoryDiscoveryModule] Probe ${probeUrl} failed: ${msg}`);
        continue;
      }

      // Requirement 11.2 — HTTP 200 or 403 triggers a finding
      // Requirement 11.3 — sensitive file + 200 → Critical
      if (statusCode === 200 || statusCode === 403) {
        const sensitive = isSensitivePath(path);
        const riskLevel: 'critical' | 'low' =
          sensitive && statusCode === 200 ? 'critical' : 'low';

        const finding = { path, statusCode, riskLevel };
        findings.push(finding);

        const name =
          riskLevel === 'critical'
            ? `Sensitive File Exposed: ${path}`
            : `Accessible Path Discovered: ${path}`;

        const description =
          riskLevel === 'critical'
            ? `The sensitive file "${path}" is publicly accessible (HTTP ${statusCode}). ` +
              `This file may contain secrets, credentials, or configuration data. ` +
              `Remove or restrict access to this resource immediately.`
            : `The path "${path}" is accessible and returned HTTP ${statusCode}. ` +
              `Verify whether this resource should be publicly reachable. ` +
              `If not, restrict access via server configuration or firewall rules.`;

        try {
          await db('vulnerabilities').insert(withId({
            scan_id: scanId,
            name,
            description,
            risk_level: riskLevel,
            owasp_category: OWASP_CATEGORY,
            affected_url: probeUrl,
            affected_param: path,
            poc_payload: `HTTP ${statusCode} response for ${probeUrl}`,
          }));
        } catch (dbErr) {
          logger.error(
            `[DirectoryDiscoveryModule] DB insert failed for path ${path}:`,
            dbErr,
          );
        }
      }
    }

    const duration = Date.now() - start;
    logger.log(
      `[DirectoryDiscoveryModule] Completed in ${duration}ms. Found ${findings.length} issue(s).`,
    );

    return { status: 'completed', findings, duration };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const directoryDiscoveryModule = new DirectoryDiscoveryModule();
export default directoryDiscoveryModule;
registerModule(directoryDiscoveryModule);
