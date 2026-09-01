/**
 * Scan lifecycle service — CRUD and validation for scan records.
 *
 * Handles:
 *  - Creating a new scan (URL validation, module validation, DB insert, activity log)
 *  - Listing a user's scans (paginated)
 *  - Fetching a single scan with its module statuses
 *  - Deleting a stopped/completed scan
 *  - Starting a scan (pending → running, concurrent limit enforcement)
 *  - Stopping a scan (running → stopped)
 *  - Listing vulnerabilities for a scan (paginated, filterable, sortable)
 *  - Fetching a single vulnerability
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 20.1, 23.1-23.4
 */

import db, { withId, withIds } from '../db';
import { logEvent } from '../utils/activityLog';
import {
  runScan,
  moduleRegistry,
  requestStop,
  isStopRequested,
} from './scanOrchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid scan module names (from the SelectedModule type in the design). */
export const VALID_MODULES = [
  'http_headers',
  'ssl_tls',
  'port_scan',
  'crawler',
  'sql_injection',
  'xss',
  'directory_discovery',
  'sensitive_info',
  'cookie_security',
] as const;

export type SelectedModule = (typeof VALID_MODULES)[number];

export type ScanStatus = 'pending' | 'running' | 'completed' | 'stopped' | 'failed';

export interface ScanSummary {
  scan_id: string;
  target_url: string;
  status: ScanStatus;
  selected_modules: SelectedModule[];
  progress_pct: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ScanModuleRecord {
  id: string;
  module_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ScanDetail extends ScanSummary {
  modules: ScanModuleRecord[];
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface CreateScanInput {
  target_url: string;
  modules: string[];
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

/** Thrown when input validation fails (→ HTTP 422). */
export class ValidationError extends Error {
  public readonly errors: { field: string; message: string }[];

  constructor(errors: { field: string; message: string }[]) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Thrown when a scan is not found or does not belong to the caller (→ HTTP 404). */
export class NotFoundError extends Error {
  constructor(message = 'Scan not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when trying to delete a scan that is running or pending (→ HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Thrown when a user tries to start a scan but already has 3 running scans
 * (→ HTTP 429).
 *
 * Requirements: 4.10, 4.11
 */
export class ConcurrentLimitError extends Error {
  constructor(message = 'Maximum concurrent scan limit reached. You may have at most 3 running scans at a time.') {
    super(message);
    this.name = 'ConcurrentLimitError';
  }
}

// ---------------------------------------------------------------------------
// URL validation helpers
// ---------------------------------------------------------------------------

/**
 * RFC 1918 and loopback ranges:
 *   10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *   127.0.0.0/8, ::1, link-local (169.254.0.0/16)
 */
const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
];

const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0']);

/**
 * Returns true when the given hostname/IP is private, loopback, or
 * link-local (RFC 1918 / RFC 3330 / IPv6 loopback).
 */
export function isPrivateOrLoopback(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Named loopback
  if (LOOPBACK_HOSTNAMES.has(lower)) {
    return true;
  }

  // IP address patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates the target URL for scan creation.
 *
 * Rules (Requirement 4.2):
 *  1. Must be parseable as a URL.
 *  2. Scheme must be http or https.
 *  3. Hostname must not be a private/loopback address.
 *  4. Hostname must not be empty.
 *
 * @returns null on success, or an error message string on failure.
 */
export function validateTargetUrl(raw: string): string | null {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    return 'target_url is required.';
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return 'target_url is not a valid URL.';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'target_url must use the HTTP or HTTPS scheme.';
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    return 'target_url must include a hostname.';
  }

  if (isPrivateOrLoopback(hostname)) {
    return 'target_url must not point to a private or loopback address.';
  }

  return null;
}

/**
 * Validates the modules array.
 *
 * Rules (Requirement 4.2):
 *  1. Must be a non-empty array.
 *  2. Every entry must be a valid SelectedModule value.
 *
 * @returns null on success, or an error message string on failure.
 */
export function validateModules(modules: unknown): string | null {
  if (!Array.isArray(modules) || modules.length === 0) {
    return 'modules must be a non-empty array.';
  }

  const validSet = new Set<string>(VALID_MODULES);
  const invalid = (modules as unknown[]).filter(
    (m) => typeof m !== 'string' || !validSet.has(m),
  );

  if (invalid.length > 0) {
    return `modules contains invalid values: ${invalid.join(', ')}. Valid modules are: ${VALID_MODULES.join(', ')}.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Creates a new scan record.
 *
 * Steps:
 *  1. Validate target_url and modules.
 *  2. INSERT scan with status "pending".
 *  3. INSERT scan_modules rows for each selected module.
 *  4. Write Activity_Log record for `scan_creation`.
 *
 * @throws {ValidationError} on invalid URL or modules (→ HTTP 422).
 */
export async function createScan(
  userId: string,
  input: CreateScanInput,
): Promise<{
  scan_id: string;
  status: ScanStatus;
  target_url: string;
  created_at: string;
}> {
  const fieldErrors: { field: string; message: string }[] = [];

  const urlError = validateTargetUrl(input.target_url);
  if (urlError) {
    fieldErrors.push({ field: 'target_url', message: urlError });
  }

  const modulesError = validateModules(input.modules);
  if (modulesError) {
    fieldErrors.push({ field: 'modules', message: modulesError });
  }

  if (fieldErrors.length > 0) {
    throw new ValidationError(fieldErrors);
  }

  // Deduplicate modules while preserving order
  const uniqueModules = [...new Set(input.modules as SelectedModule[])];

  return await db.transaction(async (trx) => {
    // Generate UUID for the scan before insert (MySQL doesn't support .returning())
    const { v4: uuidv4 } = await import('uuid');
    const scanId = uuidv4();

    // INSERT scan
    await trx('scans').insert(withId({
      id: scanId,
      user_id: userId,
      target_url: input.target_url.trim(),
      status: 'pending',
      selected_modules: JSON.stringify(uniqueModules),
      progress_pct: 0,
    }));

    // Fetch the inserted scan record
    const scan = await trx('scans')
      .where({ id: scanId })
      .first<{ id: string; target_url: string; status: string; created_at: Date }>(
        ['id', 'target_url', 'status', 'created_at'],
      );

    if (!scan) {
      throw new Error('Failed to retrieve newly created scan.');
    }

    // INSERT a scan_modules row for each selected module
    const moduleRows = uniqueModules.map((moduleName) => ({
      scan_id: scan.id,
      module_name: moduleName,
      status: 'pending',
    }));

    await trx('scan_modules').insert(withIds(moduleRows));

    // Write Activity_Log record
    await logEvent({
      eventType: 'scan_creation',
      actorUserId: userId,
      targetResourceId: scan.id,
      targetResourceType: 'scan',
      description: `Scan created for target: ${input.target_url.trim()}`,
    });

    return {
      scan_id: scan.id,
      status: scan.status as ScanStatus,
      target_url: scan.target_url,
      created_at: new Date(scan.created_at).toISOString(),
    };
  });
}

/**
 * Returns a paginated list of the caller's scans.
 *
 * @param userId  The authenticated user's ID.
 * @param options Pagination options (page, perPage).
 */
export async function getUserScans(
  userId: string,
  options: { page: number; perPage: number },
): Promise<PaginatedResult<ScanSummary>> {
  const { page, perPage } = options;
  const offset = (page - 1) * perPage;

  const [{ count }] = await db('scans')
    .where({ user_id: userId })
    .count<[{ count: string }]>('id as count');

  const total = parseInt(count, 10);

  const rows = await db('scans')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(perPage)
    .offset(offset)
    .select<
      {
        id: string;
        target_url: string;
        status: string;
        selected_modules: string | SelectedModule[];
        progress_pct: number;
        started_at: Date | null;
        completed_at: Date | null;
        created_at: Date;
      }[]
    >([
      'id',
      'target_url',
      'status',
      'selected_modules',
      'progress_pct',
      'started_at',
      'completed_at',
      'created_at',
    ]);

  const data: ScanSummary[] = rows.map((row) => ({
    scan_id: row.id,
    target_url: row.target_url,
    status: row.status as ScanStatus,
    selected_modules: (
      typeof row.selected_modules === 'string'
        ? JSON.parse(row.selected_modules)
        : row.selected_modules
    ) as SelectedModule[],
    progress_pct: row.progress_pct,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  }));

  return {
    data,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  };
}

/**
 * Returns the detail for a single scan including module statuses.
 *
 * @throws {NotFoundError} when the scan does not exist or belongs to another user.
 */
export async function getScanById(
  scanId: string,
  userId: string,
): Promise<ScanDetail> {
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{
      id: string;
      target_url: string;
      status: string;
      selected_modules: string | SelectedModule[];
      progress_pct: number;
      started_at: Date | null;
      completed_at: Date | null;
      created_at: Date;
    }>();

  if (!scan) {
    throw new NotFoundError();
  }

  const moduleRows = await db('scan_modules')
    .where({ scan_id: scanId })
    .orderBy('created_at', 'asc')
    .select<
      {
        id: string;
        module_name: string;
        status: string;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
        created_at: Date;
      }[]
    >(['id', 'module_name', 'status', 'started_at', 'completed_at', 'error_message', 'created_at']);

  const modules: ScanModuleRecord[] = moduleRows.map((m) => ({
    id: m.id,
    module_name: m.module_name,
    status: m.status,
    started_at: m.started_at ? new Date(m.started_at).toISOString() : null,
    completed_at: m.completed_at ? new Date(m.completed_at).toISOString() : null,
    error_message: m.error_message,
    created_at: new Date(m.created_at).toISOString(),
  }));

  return {
    scan_id: scan.id,
    target_url: scan.target_url,
    status: scan.status as ScanStatus,
    selected_modules: (
      typeof scan.selected_modules === 'string'
        ? JSON.parse(scan.selected_modules)
        : scan.selected_modules
    ) as SelectedModule[],
    progress_pct: scan.progress_pct,
    started_at: scan.started_at ? new Date(scan.started_at).toISOString() : null,
    completed_at: scan.completed_at ? new Date(scan.completed_at).toISOString() : null,
    created_at: new Date(scan.created_at).toISOString(),
    modules,
  };
}

/**
 * Deletes a stopped or completed scan.
 *
 * @throws {NotFoundError}  when the scan is not found or belongs to another user.
 * @throws {ConflictError}  when the scan is in "running" or "pending" status.
 */
export async function deleteScan(scanId: string, userId: string): Promise<void> {
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{ id: string; status: string }>();

  if (!scan) {
    throw new NotFoundError();
  }

  if (scan.status === 'running' || scan.status === 'pending') {
    throw new ConflictError(
      `Cannot delete a scan in "${scan.status}" status. Stop the scan first.`,
    );
  }

  await db('scans').where({ id: scanId }).delete();
}

// ---------------------------------------------------------------------------
// Scan state machine transitions
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_SCANS = 3;

/**
 * Transitions a scan from "pending" to "running" and fires off module
 * execution in the background (fire-and-forget via runScan).
 *
 * Enforces:
 *  - Scan must be in "pending" status (→ ConflictError / HTTP 409)
 *  - User must have fewer than 3 running scans (→ ConcurrentLimitError / HTTP 429)
 *
 * Writes Activity_Log record for `scan_start`.
 *
 * Requirements: 4.3, 4.4, 4.10, 4.11, 20.1
 *
 * @throws {NotFoundError}        scan not found / belongs to another user
 * @throws {ConflictError}        scan is not in "pending" status
 * @throws {ConcurrentLimitError} user already has 3 running scans
 */
export async function startScan(
  scanId: string,
  userId: string,
): Promise<{ scan_id: string; status: ScanStatus }> {
  // Fetch the scan (scoped to this user)
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{ id: string; status: string; target_url: string; selected_modules: string | string[] }>();

  if (!scan) {
    throw new NotFoundError();
  }

  if (scan.status !== 'pending') {
    throw new ConflictError(
      `Cannot start a scan in "${scan.status}" status. Only "pending" scans can be started.`,
    );
  }

  // Enforce concurrent scan limit
  const [{ count }] = await db('scans')
    .where({ user_id: userId, status: 'running' })
    .count<[{ count: string }]>('id as count');

  if (parseInt(count, 10) >= MAX_CONCURRENT_SCANS) {
    throw new ConcurrentLimitError();
  }

  // Transition to running
  await db('scans')
    .where({ id: scanId })
    .update({ status: 'running', started_at: new Date() });

  await logEvent({
    eventType: 'scan_start',
    actorUserId: userId,
    targetResourceId: scanId,
    targetResourceType: 'scan',
    description: `Scan started for target: ${scan.target_url}`,
  });

  // Build module list from registry
  const selectedModules: string[] =
    typeof scan.selected_modules === 'string'
      ? JSON.parse(scan.selected_modules)
      : scan.selected_modules;

  const modules = selectedModules
    .map((name) => moduleRegistry.get(name))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  // Fire-and-forget: run scan in background
  runScan(scanId, scan.target_url, modules, userId).catch((err) => {
    console.error(`[scanService] Unhandled error in runScan for scan ${scanId}:`, err);
  });

  return { scan_id: scanId, status: 'running' };
}

/**
 * Requests the orchestrator to stop a running scan and, if it is still
 * marked "running" in the DB, transitions it to "stopped" immediately.
 *
 * The orchestrator's per-module loop also checks the stop flag and will
 * cease starting new modules once it sees it.
 *
 * Writes Activity_Log record for `scan_stop`.
 *
 * Requirements: 4.6, 4.7, 20.1
 *
 * @throws {NotFoundError}  scan not found / belongs to another user
 * @throws {ConflictError}  scan is not in "running" status
 */
export async function stopScan(
  scanId: string,
  userId: string,
): Promise<{ scan_id: string; status: ScanStatus }> {
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{ id: string; status: string }>();

  if (!scan) {
    throw new NotFoundError();
  }

  if (scan.status !== 'running') {
    throw new ConflictError(
      `Cannot stop a scan in "${scan.status}" status. Only "running" scans can be stopped.`,
    );
  }

  // Signal the orchestrator (if active) to stop after the current module
  requestStop(scanId);

  // If the orchestrator is not currently executing (e.g., the server restarted),
  // directly transition the DB record to "stopped".
  // The orchestrator will also write "stopped" when it sees the flag — both
  // paths produce the same result (idempotent update).
  await db('scans')
    .where({ id: scanId, status: 'running' })
    .update({ status: 'stopped', completed_at: new Date() });

  await logEvent({
    eventType: 'scan_stop',
    actorUserId: userId,
    targetResourceId: scanId,
    targetResourceType: 'scan',
    description: `Scan stop requested by user.`,
  });

  return { scan_id: scanId, status: 'stopped' };
}

// ---------------------------------------------------------------------------
// Vulnerability types & service functions (Requirements 23.1-23.4)
// ---------------------------------------------------------------------------

export type RiskLevel = 'informational' | 'low' | 'medium' | 'high' | 'critical';

/** Maps risk level to a sort weight so we can order by severity */
const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface VulnerabilityRecord {
  id: string;
  scan_id: string;
  name: string;
  description: string | null;
  risk_level: RiskLevel;
  owasp_category: string;
  affected_url: string | null;
  affected_param: string | null;
  poc_payload: string | null;
  screenshot_path: string | null;
  ai_score: number | null;
  ai_description: string | null;
  ai_remediation: string | null;
  discovered_at: string;
}

export interface GetVulnerabilitiesOptions {
  page: number;
  perPage: number;
  riskLevel?: string;
  owasp?: string;
  sortBy?: 'risk_score' | 'risk_level' | 'discovered_at';
  order?: 'asc' | 'desc';
}

/**
 * Returns a paginated, filtered, sorted list of vulnerabilities for a scan.
 *
 * The scan must belong to the specified userId; otherwise NotFoundError is thrown.
 *
 * sortBy mapping:
 *  - 'risk_score'   → ai_score column (Requirements 23.2)
 *  - 'risk_level'   → risk_level column
 *  - 'discovered_at' → discovered_at column
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4
 */
export async function getVulnerabilities(
  scanId: string,
  userId: string,
  options: GetVulnerabilitiesOptions,
): Promise<PaginatedResult<VulnerabilityRecord>> {
  // Verify the scan exists and belongs to this user
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{ id: string } | undefined>(['id']);

  if (!scan) {
    throw new NotFoundError('Scan not found.');
  }

  const { page, perPage, riskLevel, owasp, sortBy = 'risk_score', order = 'desc' } = options;
  const offset = (page - 1) * perPage;

  // Build base query
  let query = db('vulnerabilities').where({ scan_id: scanId });

  if (riskLevel) {
    query = query.where({ risk_level: riskLevel });
  }

  if (owasp) {
    query = query.where({ owasp_category: owasp });
  }

  // Count total
  const [{ count }] = await query.clone().count<[{ count: string }]>('id as count');
  const total = parseInt(count, 10);

  // Determine sort column
  const sortColumn =
    sortBy === 'risk_score'
      ? 'ai_score'
      : sortBy === 'risk_level'
      ? 'risk_level'
      : 'discovered_at';

  // For ai_score, NULLs should sort last regardless of order
  const rows = await query
    .orderByRaw(
      sortBy === 'risk_score'
        ? `ai_score ${order === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST'}`
        : `${sortColumn} ${order.toUpperCase()}`,
    )
    .limit(perPage)
    .offset(offset)
    .select<VulnerabilityRecord[]>([
      'id',
      'scan_id',
      'name',
      'description',
      'risk_level',
      'owasp_category',
      'affected_url',
      'affected_param',
      'poc_payload',
      'screenshot_path',
      'ai_score',
      'ai_description',
      'ai_remediation',
      'discovered_at',
    ]);

  const data: VulnerabilityRecord[] = rows.map((row) => ({
    ...row,
    discovered_at: new Date(row.discovered_at).toISOString(),
  }));

  return {
    data,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  };
}

/**
 * Returns a single vulnerability record.
 * The scan must belong to the userId; the vulnerability must belong to the scan.
 *
 * Requirements: 23.1
 */
export async function getVulnerabilityById(
  scanId: string,
  vulnId: string,
  userId: string,
): Promise<VulnerabilityRecord> {
  // Verify scan ownership
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<{ id: string } | undefined>(['id']);

  if (!scan) {
    throw new NotFoundError('Scan not found.');
  }

  const vuln = await db('vulnerabilities')
    .where({ id: vulnId, scan_id: scanId })
    .first<VulnerabilityRecord | undefined>([
      'id',
      'scan_id',
      'name',
      'description',
      'risk_level',
      'owasp_category',
      'affected_url',
      'affected_param',
      'poc_payload',
      'screenshot_path',
      'ai_score',
      'ai_description',
      'ai_remediation',
      'discovered_at',
    ]);

  if (!vuln) {
    throw new NotFoundError('Vulnerability not found.');
  }

  return {
    ...vuln,
    discovered_at: new Date(vuln.discovered_at).toISOString(),
  };
}
