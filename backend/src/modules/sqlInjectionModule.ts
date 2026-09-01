/**
 * SqlInjectionModule — detects SQL injection vulnerabilities via two strategies:
 *
 *  1. OWASP ZAP Active Scan (REST API) against each discovered URL.
 *  2. Custom payload injection into every form parameter and URL query
 *     parameter discovered by the CrawlerModule:
 *       - Error-based payloads: look for DB error strings in the response body.
 *       - Time-based payloads: measure response time; delay ≥ 5 s → Critical.
 *
 * ZAP integration is optional — if ZAP is unreachable the module falls back
 * to the custom payload strategy only and logs a warning.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 * OWASP: A03:2021 – Injection
 */

import {
  ScanModule,
  ScanContext,
  ModuleResult,
  registerModule,
} from '../services/scanOrchestrator';
import { withId } from '../db';
import type { SiteMap, FormRecord } from './crawlerModule';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ZAP_API_URL = process.env.ZAP_API_URL ?? 'http://localhost:8080';
const ZAP_API_KEY = process.env.ZAP_API_KEY ?? '';
const OWASP_CATEGORY = 'A03:2021 – Injection';

/** Time-based detection threshold in milliseconds. */
const TIME_DELAY_THRESHOLD_MS = 5_000;

/** HTTP request timeout for individual payload probes (ms). */
const PROBE_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Payload sets
// ---------------------------------------------------------------------------

const ERROR_BASED_PAYLOADS = [
  `' OR '1'='1`,
  `'; DROP TABLE test--`,
  `' OR 1=1--`,
  `" OR "1"="1`,
  `') OR ('1'='1`,
];

const TIME_BASED_PAYLOADS = [
  `'; SELECT SLEEP(5)--`,
  `'; WAITFOR DELAY '0:0:5'--`,
  `' OR SLEEP(5)--`,
  `' AND 1=CONVERT(int,(SELECT SLEEP(5)))--`,
];

/** SQL error patterns to detect in response bodies. */
const SQL_ERROR_PATTERNS = [
  /sql syntax/i,
  /unclosed quotation mark/i,
  /quoted string not properly terminated/i,
  /ORA-\d{5}/,
  /Microsoft OLE DB/i,
  /ODBC SQL Server Driver/i,
  /PostgreSQL.*ERROR/i,
  /Warning.*mysql_/i,
  /com\.mysql\.jdbc/i,
  /SQLiteException/i,
  /System\.Data\.SqlClient/i,
  /PG::SyntaxError/i,
  /mysql_fetch_array/i,
  /supplied argument is not a valid MySQL/i,
];

// ---------------------------------------------------------------------------
// fetch helper (dynamic import for ESM node-fetch)
// ---------------------------------------------------------------------------

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

let _fetch: FetchFn | null = null;

async function getFetch(): Promise<FetchFn> {
  if (!_fetch) {
    const mod = await import('node-fetch');
    _fetch = mod.default as unknown as FetchFn;
  }
  return _fetch;
}

// ---------------------------------------------------------------------------
// ZAP integration
// ---------------------------------------------------------------------------

/**
 * Triggers a ZAP active scan against the given URL.
 * Returns true when the scan was successfully initiated.
 */
async function triggerZapScan(targetUrl: string, logger: typeof console): Promise<boolean> {
  const fetch = await getFetch();
  const endpoint =
    `${ZAP_API_URL}/JSON/ascan/action/scan/` +
    `?url=${encodeURIComponent(targetUrl)}` +
    `&apikey=${encodeURIComponent(ZAP_API_KEY)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal as RequestInit['signal'],
    });
    clearTimeout(timer);

    if (!response.ok) {
      logger.warn(
        `[SqlInjectionModule] ZAP returned HTTP ${response.status} for active scan trigger.`,
      );
      return false;
    }

    const body = (await response.json()) as Record<string, unknown>;
    logger.log(`[SqlInjectionModule] ZAP active scan initiated. Response:`, body);
    return true;
  } catch (err) {
    logger.warn(
      `[SqlInjectionModule] ZAP unavailable (${err instanceof Error ? err.message : String(err)}). ` +
        `Falling back to custom payloads only.`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Custom payload probing
// ---------------------------------------------------------------------------

interface ProbeResult {
  vulnerable: boolean;
  type: 'error' | 'time' | null;
  payload: string;
  responseTimeMs: number;
}

/**
 * Sends a GET request with the given query-string parameter replaced by payload.
 */
async function probeGetParam(
  baseUrl: string,
  paramName: string,
  paramValue: string,
  payload: string,
): Promise<{ body: string; durationMs: number }> {
  const fetch = await getFetch();
  const url = new URL(baseUrl);
  url.searchParams.set(paramName, payload);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal as RequestInit['signal'],
    });
    const body = await res.text();
    return { body, durationMs: Date.now() - t0 };
  } catch {
    return { body: '', durationMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a POST request with the given form field replaced by payload.
 */
async function probePostParam(
  actionUrl: string,
  fields: Record<string, string>,
  paramName: string,
  payload: string,
): Promise<{ body: string; durationMs: number }> {
  const fetch = await getFetch();
  const body = new URLSearchParams({ ...fields, [paramName]: payload });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal as RequestInit['signal'],
    });
    const text = await res.text();
    return { body: text, durationMs: Date.now() - t0 };
  } catch {
    return { body: '', durationMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measures baseline response time for a URL (plain GET, no injected payload).
 */
async function measureBaseline(url: string): Promise<number> {
  const fetch = await getFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    await fetch(url, { signal: controller.signal as RequestInit['signal'] });
  } catch {
    // ignore
  } finally {
    clearTimeout(timer);
  }
  return Date.now() - t0;
}

/**
 * Tests a single (url, paramName, paramValue, method) combination against all
 * error-based and time-based payloads.
 */
async function testParam(
  method: 'GET' | 'POST',
  url: string,
  paramName: string,
  paramValue: string,
  allFields: Record<string, string>,
  baselineMs: number,
  logger: typeof console,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  // --- Error-based ---
  for (const payload of ERROR_BASED_PAYLOADS) {
    let body = '';
    let durationMs = 0;

    if (method === 'GET') {
      ({ body, durationMs } = await probeGetParam(url, paramName, paramValue, payload));
    } else {
      ({ body, durationMs } = await probePostParam(url, allFields, paramName, payload));
    }

    const isVulnerable = SQL_ERROR_PATTERNS.some((re) => re.test(body));
    if (isVulnerable) {
      logger.warn(
        `[SqlInjectionModule] Error-based SQLi detected: ${url} param="${paramName}" payload="${payload}"`,
      );
      results.push({ vulnerable: true, type: 'error', payload, responseTimeMs: durationMs });
      break; // one confirmed finding per param is enough
    }
  }

  // --- Time-based ---
  for (const payload of TIME_BASED_PAYLOADS) {
    let durationMs = 0;

    if (method === 'GET') {
      ({ durationMs } = await probeGetParam(url, paramName, paramValue, payload));
    } else {
      ({ durationMs } = await probePostParam(url, allFields, paramName, payload));
    }

    const delay = durationMs - baselineMs;
    if (delay >= TIME_DELAY_THRESHOLD_MS) {
      logger.warn(
        `[SqlInjectionModule] Time-based SQLi detected: ${url} param="${paramName}" ` +
          `payload="${payload}" delay=${delay}ms`,
      );
      results.push({ vulnerable: true, type: 'time', payload, responseTimeMs: durationMs });
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class SqlInjectionModule implements ScanModule {
  readonly name = 'sql_injection';
  readonly timeout = 600; // 10 minutes

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];
    const { scanId, targetUrl, db, logger } = ctx;

    logger.log(`[SqlInjectionModule] Starting SQL injection scan for ${targetUrl}`);

    // Retrieve site map from context (populated by CrawlerModule)
    const siteMap = ctx.siteMap as SiteMap | undefined;

    // -----------------------------------------------------------------------
    // Strategy 1: OWASP ZAP Active Scan
    // -----------------------------------------------------------------------
    const zapAvailable = await triggerZapScan(targetUrl, logger);
    if (zapAvailable && siteMap) {
      for (const url of siteMap.urls.slice(0, 50)) {
        // Don't hammer ZAP; limit to first 50 unique URLs
        await triggerZapScan(url, logger).catch(() => undefined);
      }
    }

    if (!siteMap) {
      logger.warn(
        '[SqlInjectionModule] No site map available from crawler — falling back to target URL only.',
      );
    }

    // -----------------------------------------------------------------------
    // Strategy 2: Custom payload injection
    // -----------------------------------------------------------------------

    // Build a list of (method, url, paramName, paramValue, allFields) tuples
    interface TestTarget {
      method: 'GET' | 'POST';
      url: string;
      paramName: string;
      paramValue: string;
      allFields: Record<string, string>;
    }

    const targets: TestTarget[] = [];

    // a) URL query parameters from crawled URLs
    const urlsToTest = siteMap ? siteMap.urls : [targetUrl];
    for (const u of urlsToTest) {
      try {
        const parsed = new URL(u);
        for (const [name, value] of parsed.searchParams.entries()) {
          targets.push({
            method: 'GET',
            url: u,
            paramName: name,
            paramValue: value,
            allFields: {},
          });
        }
      } catch {
        // ignore invalid URLs
      }
    }

    // b) Form parameters from discovered forms
    const forms: FormRecord[] = siteMap ? siteMap.forms : [];
    for (const form of forms) {
      const defaultFields: Record<string, string> = {};
      for (const field of form.fields) {
        defaultFields[field] = 'test';
      }
      for (const field of form.fields) {
        targets.push({
          method: form.method,
          url: form.action_url,
          paramName: field,
          paramValue: 'test',
          allFields: defaultFields,
        });
      }
    }

    // De-duplicate (same url + method + param)
    const seen = new Set<string>();
    const dedupedTargets = targets.filter((t) => {
      const key = `${t.method}:${t.url}:${t.paramName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.log(
      `[SqlInjectionModule] Testing ${dedupedTargets.length} parameter(s) with custom payloads.`,
    );

    // Track which (url, param) pairs already have a confirmed finding to avoid duplicate inserts
    const confirmedPairs = new Set<string>();

    for (const target of dedupedTargets) {
      const baselineMs = await measureBaseline(target.url);

      const probeResults = await testParam(
        target.method,
        target.url,
        target.paramName,
        target.paramValue,
        target.allFields,
        baselineMs,
        logger,
      );

      for (const probe of probeResults) {
        if (!probe.vulnerable) continue;

        const pairKey = `${target.url}:${target.paramName}:${probe.type}`;
        if (confirmedPairs.has(pairKey)) continue;
        confirmedPairs.add(pairKey);

        const isTimeBased = probe.type === 'time';
        const name = isTimeBased
          ? `Time-Based SQL Injection in parameter "${target.paramName}"`
          : `Error-Based SQL Injection in parameter "${target.paramName}"`;

        const description = isTimeBased
          ? `A time-based SQL injection vulnerability was detected in parameter ` +
            `"${target.paramName}" on ${target.url}. ` +
            `The payload "${probe.payload}" caused a response delay of ` +
            `${probe.responseTimeMs}ms (baseline: ${baselineMs}ms), indicating ` +
            `blind SQL injection. An attacker could enumerate or exfiltrate the database.`
          : `An error-based SQL injection vulnerability was detected in parameter ` +
            `"${target.paramName}" on ${target.url}. ` +
            `The payload "${probe.payload}" triggered a database error in the response, ` +
            `revealing details about the underlying SQL query structure.`;

        const finding = {
          url: target.url,
          param: target.paramName,
          payload: probe.payload,
          type: probe.type,
        };
        findings.push(finding);

        try {
          await db('vulnerabilities').insert(withId({
            scan_id: scanId,
            name,
            description,
            risk_level: isTimeBased ? 'critical' : 'high',
            owasp_category: OWASP_CATEGORY,
            affected_url: target.url,
            affected_param: target.paramName,
            poc_payload: probe.payload,
          }));
        } catch (dbErr) {
          logger.error(
            `[SqlInjectionModule] DB insert failed for finding on ${target.url} param "${target.paramName}":`,
            dbErr,
          );
        }
      }
    }

    const duration = Date.now() - start;
    logger.log(
      `[SqlInjectionModule] Completed in ${duration}ms. Found ${findings.length} SQLi finding(s).`,
    );

    return { status: 'completed', findings, duration };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const sqlInjectionModule = new SqlInjectionModule();
export default sqlInjectionModule;
registerModule(sqlInjectionModule);
