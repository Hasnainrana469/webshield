/**
 * CookieSecurityModule — evaluates Set-Cookie headers from the target URL
 * for missing HttpOnly, Secure, and SameSite attributes.
 *
 * Risk assignment (one vulnerability per affected cookie):
 *  - Session-like name (session|auth|token|sid) missing HttpOnly → Medium
 *  - Any cookie missing Secure when target is HTTPS               → Low
 *  - Any cookie missing SameSite                                  → Low
 *
 * Uses node-fetch (ESM) via dynamic import.
 * Set-Cookie headers are parsed manually with regex (no tough-cookie dependency).
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 * OWASP: A07:2021 – Identification and Authentication Failures
 */

import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const OWASP_CATEGORY = 'A07:2021 – Identification and Authentication Failures';

// ---------------------------------------------------------------------------
// Session-like name matcher (Requirement 13.2)
// ---------------------------------------------------------------------------

const SESSION_NAME_PATTERN = /session|auth|token|sid/i;

function isSessionLike(cookieName: string): boolean {
  return SESSION_NAME_PATTERN.test(cookieName);
}

// ---------------------------------------------------------------------------
// Cookie attribute parsing (manual, no tough-cookie)
// ---------------------------------------------------------------------------

interface ParsedCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}

/**
 * Parses a raw Set-Cookie header string into its name, value, and security
 * attributes. All matching is done case-insensitively against the directive
 * names.
 *
 * Example input:
 *   "sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Strict"
 */
function parseCookieHeader(raw: string): ParsedCookie | null {
  if (!raw || raw.trim().length === 0) return null;

  // Split on semicolons to get directives; first part is name=value
  const parts = raw.split(';').map((p) => p.trim());

  const nameValuePart = parts[0];
  if (!nameValuePart) return null;

  // Extract name and value — value may contain '='
  const eqIdx = nameValuePart.indexOf('=');
  const name = eqIdx >= 0 ? nameValuePart.substring(0, eqIdx).trim() : nameValuePart.trim();
  const value = eqIdx >= 0 ? nameValuePart.substring(eqIdx + 1).trim() : '';

  if (!name) return null;

  // Remaining parts are directives (no value, or key=value)
  const directives = parts.slice(1).map((d) => d.toLowerCase());

  const httpOnly = directives.some((d) => d === 'httponly');
  const secure = directives.some((d) => d === 'secure');

  // SameSite can be "samesite=strict", "samesite=lax", "samesite=none"
  let sameSite: string | null = null;
  for (const d of directives) {
    if (d.startsWith('samesite')) {
      const eqPos = d.indexOf('=');
      sameSite = eqPos >= 0 ? d.substring(eqPos + 1).trim() : 'present';
      break;
    }
  }

  return { name, value, httpOnly, secure, sameSite };
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class CookieSecurityModule implements ScanModule {
  readonly name = 'cookie_security';
  readonly timeout = 30; // seconds

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];

    const { scanId, targetUrl, db, logger } = ctx;

    logger.log(`[CookieSecurityModule] Starting cookie security analysis for ${targetUrl}`);

    // Determine whether the target uses HTTPS
    let isHttps = false;
    try {
      const parsed = new URL(targetUrl);
      isHttps = parsed.protocol === 'https:';
    } catch {
      logger.error(`[CookieSecurityModule] Invalid target URL: ${targetUrl}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    // Fetch target URL (GET) to retrieve Set-Cookie headers
    let setCookieHeaders: string[] = [];

    try {
      const { default: fetchFn } = await import('node-fetch') as {
        default: typeof import('node-fetch').default;
      };

      const response = await fetchFn(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });

      // node-fetch exposes multiple Set-Cookie values via raw() or getAll()
      const rawHeaders = response.headers as unknown as {
        raw(): Record<string, string[]>;
        getAll?(name: string): string[];
        get(name: string): string | null;
      };

      if (typeof rawHeaders.raw === 'function') {
        const rawMap = rawHeaders.raw();
        const cookieValues = rawMap['set-cookie'] ?? rawMap['Set-Cookie'] ?? [];
        setCookieHeaders = cookieValues;
      } else if (typeof rawHeaders.getAll === 'function') {
        setCookieHeaders = rawHeaders.getAll('set-cookie');
      } else {
        const single = rawHeaders.get('set-cookie');
        if (single) setCookieHeaders = [single];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CookieSecurityModule] Fetch failed for ${targetUrl}: ${msg}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    if (setCookieHeaders.length === 0) {
      logger.log(`[CookieSecurityModule] No Set-Cookie headers found for ${targetUrl}.`);
      return { status: 'completed', findings, duration: Date.now() - start };
    }

    logger.log(
      `[CookieSecurityModule] Evaluating ${setCookieHeaders.length} cookie(s).`,
    );

    for (const rawCookieStr of setCookieHeaders) {
      const cookie = parseCookieHeader(rawCookieStr);

      if (!cookie) {
        logger.log(`[CookieSecurityModule] Could not parse cookie header: ${rawCookieStr}`);
        continue;
      }

      const cookieName = cookie.name || '(unnamed)';

      // --- Check 1: Session-like cookie missing HttpOnly (Requirement 13.2) ---
      if (isSessionLike(cookieName) && !cookie.httpOnly) {
        const finding = { cookieName, issue: 'missing_httponly', riskLevel: 'medium' };
        findings.push(finding);

        try {
          await db('vulnerabilities').insert(withId({ scan_id: scanId, name: `Cookie Missing HttpOnly Attribute: ${cookieName}`, description: `The session cookie "${cookieName}" is missing HttpOnly.`, risk_level: 'medium', owasp_category: OWASP_CATEGORY, affected_url: targetUrl, affected_param: cookieName, poc_payload: `Set-Cookie: ${rawCookieStr}` }));
        } catch (dbErr) {
          logger.error(
            `[CookieSecurityModule] DB insert failed (HttpOnly) for cookie "${cookieName}":`,
            dbErr,
          );
        }
      }

      // --- Check 2: Cookie missing Secure on an HTTPS target (Requirement 13.3) ---
      if (isHttps && !cookie.secure) {
        const finding = { cookieName, issue: 'missing_secure', riskLevel: 'low' };
        findings.push(finding);

        try {
          await db('vulnerabilities').insert(withId({
            scan_id: scanId,
            name: `Cookie Missing Secure Attribute: ${cookieName}`,
            description: `The cookie "${cookieName}" is missing the Secure attribute on an HTTPS target.`,
            risk_level: 'low',
            owasp_category: OWASP_CATEGORY,
            affected_url: targetUrl,
            affected_param: cookieName,
            poc_payload: `Set-Cookie: ${rawCookieStr}`,
          }));
        } catch (dbErr) {
          logger.error(
            `[CookieSecurityModule] DB insert failed (Secure) for cookie "${cookieName}":`,
            dbErr,
          );
        }
      }

      if (cookie.sameSite === null) {
        findings.push({ cookieName, issue: 'missing_samesite', riskLevel: 'low' });
        try {
          await db('vulnerabilities').insert(withId({
            scan_id: scanId,
            name: `Cookie Missing SameSite Attribute: ${cookieName}`,
            description: `The cookie "${cookieName}" is missing the SameSite attribute.`,
            risk_level: 'low',
            owasp_category: OWASP_CATEGORY,
            affected_url: targetUrl,
            affected_param: cookieName,
            poc_payload: `Set-Cookie: ${rawCookieStr}`,
          }));
        } catch (dbErr) {
          logger.error(
            `[CookieSecurityModule] DB insert failed (SameSite) for cookie "${cookieName}":`,
            dbErr,
          );
        }
      }
    }

    const duration = Date.now() - start;
    logger.log(
      `[CookieSecurityModule] Completed in ${duration}ms. Found ${findings.length} issue(s).`,
    );

    return { status: 'completed', findings, duration };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const cookieSecurityModule = new CookieSecurityModule();
export default cookieSecurityModule;
registerModule(cookieSecurityModule);
