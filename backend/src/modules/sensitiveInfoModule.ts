/**
 * SensitiveInfoModule — scans crawled URLs for sensitive information exposed
 * in HTTP response bodies and headers.
 *
 * Pattern categories:
 *  - API key / credential → Critical, A02:2021
 *  - Stack trace           → Medium,   A05:2021
 *  - Debug info header     → Medium,   A05:2021
 *  - Internal IP (RFC1918) → Low,      A05:2021
 *  - Email address         → Low,      A05:2021
 *
 * IMPORTANT: Only the pattern TYPE is stored in the vulnerability record,
 * never the matched value.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';

interface PatternConfig {
  /** Short human-readable label (stored in vuln record). */
  patternType: string;
  /** Regex applied against response body (string) or header value. */
  pattern: RegExp;
  /** Where to search: body, headers, or both. */
  scope: 'body' | 'headers' | 'both';
  riskLevel: RiskLevel;
  owaspCategory: string;
  name: string;
  descriptionTemplate: (url: string) => string;
}

const PATTERNS: PatternConfig[] = [
  // --- API key / generic credential pattern (body) ---
  {
    patternType: 'API Key Pattern',
    // Non-capturing groups around the key name alternatives; never captures the value
    pattern: /(?:api[_-]?key|apikey|api_secret)\s*[:=]\s*\S+/i,
    scope: 'body',
    riskLevel: 'critical',
    owaspCategory: 'A02:2021 – Cryptographic Failures',
    name: 'API Key or Credential Exposed in Response Body',
    descriptionTemplate: (url) =>
      `An API key or credential pattern (API Key Pattern) was detected in the response body of "${url}". ` +
      `Exposed credentials can allow attackers to access third-party services or internal APIs. ` +
      `Remove secrets from application responses and rotate any exposed keys immediately.`,
  },
  // --- AWS AKIA key (body) ---
  {
    patternType: 'AWS Access Key Pattern',
    pattern: /AKIA[0-9A-Z]{16}/,
    scope: 'body',
    riskLevel: 'critical',
    owaspCategory: 'A02:2021 – Cryptographic Failures',
    name: 'AWS Access Key Exposed in Response Body',
    descriptionTemplate: (url) =>
      `An AWS access key ID pattern (AWS Access Key Pattern) was detected in the response body of "${url}". ` +
      `Exposed AWS credentials can grant attackers full cloud account access. ` +
      `Rotate the key immediately, audit CloudTrail for unauthorized usage, and remove the key from the response.`,
  },
  // --- Stack trace (body) ---
  {
    patternType: 'Stack Trace Pattern',
    pattern: /at Object\.<anonymous>|Exception in thread|Traceback \(most recent/,
    scope: 'body',
    riskLevel: 'medium',
    owaspCategory: 'A05:2021 – Security Misconfiguration',
    name: 'Stack Trace Exposed in Response Body',
    descriptionTemplate: (url) =>
      `A stack trace pattern (Stack Trace Pattern) was detected in the response body of "${url}". ` +
      `Stack traces reveal internal file paths, class names, and application structure, ` +
      `which can aid attackers in crafting targeted exploits. ` +
      `Disable detailed error output in production environments.`,
  },
  // --- Debug / version-disclosure headers ---
  {
    patternType: 'Debug Info Header',
    // Check for presence of debug or version-disclosure headers by name
    // Applied against serialized header key names
    pattern: /^(?:x-debug|x-powered-by|server)\s*:/im,
    scope: 'headers',
    riskLevel: 'medium',
    owaspCategory: 'A05:2021 – Security Misconfiguration',
    name: 'Debug or Version-Disclosure Header Present',
    descriptionTemplate: (url) =>
      `A debug or version-disclosure header (X-Debug, X-Powered-By, or Server) ` +
      `was detected in the response headers of "${url}". ` +
      `These headers disclose technology stack details that can assist attackers in identifying ` +
      `known vulnerabilities. Remove or suppress these headers in production.`,
  },
  // --- Internal IP (RFC 1918) (body) ---
  {
    patternType: 'Internal IP Address Pattern',
    // Non-capturing groups for the IP range alternatives
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
    scope: 'body',
    riskLevel: 'low',
    owaspCategory: 'A05:2021 – Security Misconfiguration',
    name: 'Internal IP Address Exposed in Response Body',
    descriptionTemplate: (url) =>
      `An RFC 1918 internal IP address pattern was detected in the response body of "${url}". ` +
      `Exposing internal network topology can assist attackers in mapping infrastructure. ` +
      `Remove internal IP references from public-facing responses.`,
  },
  // --- Email address (body) ---
  {
    patternType: 'Email Address Pattern',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
    scope: 'body',
    riskLevel: 'low',
    owaspCategory: 'A05:2021 – Security Misconfiguration',
    name: 'Email Address Exposed in Response Body',
    descriptionTemplate: (url) =>
      `An email address pattern was detected in the response body of "${url}". ` +
      `Exposed email addresses can be harvested for phishing or spam campaigns. ` +
      `Evaluate whether this disclosure is intentional; if not, remove or obfuscate the address.`,
  },
];

// ---------------------------------------------------------------------------
// SiteMap type
// ---------------------------------------------------------------------------

interface SiteMapLike {
  urls?: string[];
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class SensitiveInfoModule implements ScanModule {
  readonly name = 'sensitive_info';
  readonly timeout = 120; // seconds

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];

    const { scanId, targetUrl, siteMap, db, logger } = ctx;

    logger.log(`[SensitiveInfoModule] Starting sensitive info analysis for ${targetUrl}`);

    // Collect URLs to inspect: siteMap URLs + the target itself
    const urlsToScan: string[] = [targetUrl];

    if (siteMap && typeof siteMap === 'object') {
      const sm = siteMap as SiteMapLike;
      if (Array.isArray(sm.urls)) {
        for (const u of sm.urls) {
          if (typeof u === 'string' && u !== targetUrl) {
            urlsToScan.push(u);
          }
        }
      }
    }

    logger.log(`[SensitiveInfoModule] Will inspect ${urlsToScan.length} URL(s).`);

    // Dynamically import ESM node-fetch
    let fetchFn: typeof import('node-fetch').default;
    try {
      const mod = await import('node-fetch') as { default: typeof import('node-fetch').default };
      fetchFn = mod.default;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[SensitiveInfoModule] Failed to import node-fetch: ${msg}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    // Track (url, patternType) pairs already reported to avoid duplicate vulns
    const reported = new Set<string>();

    for (const url of urlsToScan) {
      let body = '';
      let headerText = '';

      try {
        const response = await fetchFn(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });

        body = await response.text();

        // Serialize all response header key:value pairs for header-scoped patterns
        const headersObj = response.headers as unknown as {
          forEach(callback: (value: string, name: string) => void): void;
        };
        const headerParts: string[] = [];
        headersObj.forEach((value: string, name: string) => {
          headerParts.push(`${name}: ${value}`);
        });
        headerText = headerParts.join('\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.log(`[SensitiveInfoModule] Fetch failed for ${url}: ${msg}`);
        continue;
      }

      for (const cfg of PATTERNS) {
        const dedupKey = `${url}::${cfg.patternType}`;
        if (reported.has(dedupKey)) continue;

        let matched = false;

        if (cfg.scope === 'body' || cfg.scope === 'both') {
          if (cfg.pattern.test(body)) matched = true;
        }

        if (!matched && (cfg.scope === 'headers' || cfg.scope === 'both')) {
          if (cfg.pattern.test(headerText)) matched = true;
        }

        if (!matched) continue;

        reported.add(dedupKey);
        findings.push({ url, patternType: cfg.patternType, riskLevel: cfg.riskLevel });

        try {
          await db('vulnerabilities').insert(withId({
            scan_id: scanId,
            name: cfg.name,
            description: cfg.descriptionTemplate(url),
            risk_level: cfg.riskLevel,
            owasp_category: cfg.owaspCategory,
            affected_url: url,
            affected_param: cfg.patternType,
            poc_payload: `Detected pattern type: ${cfg.patternType}`,
          }));
        } catch (dbErr) {
          logger.error(
            `[SensitiveInfoModule] DB insert failed for ${cfg.patternType} at ${url}:`,
            dbErr,
          );
        }
      }
    }

    const duration = Date.now() - start;
    logger.log(
      `[SensitiveInfoModule] Completed in ${duration}ms. Found ${findings.length} issue(s).`,
    );

    return { status: 'completed', findings, duration };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const sensitiveInfoModule = new SensitiveInfoModule();
export default sensitiveInfoModule;
registerModule(sensitiveInfoModule);
