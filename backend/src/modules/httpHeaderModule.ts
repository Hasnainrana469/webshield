import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const HEADER_RULES = [
  ['content-security-policy', 'Content-Security-Policy', 'medium'],
  ['x-frame-options', 'X-Frame-Options', 'medium'],
  ['x-content-type-options', 'X-Content-Type-Options', 'low'],
  ['strict-transport-security', 'Strict-Transport-Security', 'high'],
  ['referrer-policy', 'Referrer-Policy', 'low'],
  ['permissions-policy', 'Permissions-Policy', 'low'],
] as const;

class HttpHeaderModule implements ScanModule {
  readonly name = 'http_headers';
  readonly timeout = 60;

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const startedAt = Date.now();
    const findings: unknown[] = [];
    try {
      const response = await fetch(ctx.targetUrl, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      for (const [header, displayName, risk] of HEADER_RULES) {
        if (response.headers.get(header)) continue;
        findings.push({ headerName: header, issue: 'absent', riskLevel: risk });
        try {
          await ctx.db('vulnerabilities').insert(withId({
            scan_id: ctx.scanId,
            name: `Missing ${displayName} Header`,
            description: `The ${displayName} security header is absent.`,
            risk_level: risk,
            owasp_category: 'A05:2021 - Security Misconfiguration',
            affected_url: ctx.targetUrl,
            affected_param: displayName,
          }));
        } catch (error) {
          ctx.logger.error('[HttpHeaderModule] Failed to persist finding:', error);
        }
      }
      return { status: 'completed', findings, duration: Date.now() - startedAt };
    } catch (error) {
      ctx.logger.error('[HttpHeaderModule] Target request failed:', error);
      return { status: 'failed', findings, duration: Date.now() - startedAt };
    }
  }
}

const httpHeaderModule = new HttpHeaderModule();
export default httpHeaderModule;
registerModule(httpHeaderModule);
