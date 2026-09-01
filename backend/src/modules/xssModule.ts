import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const XSS_PAYLOAD = '<script>alert(1)</script>';

class XssModule implements ScanModule {
  readonly name = 'xss';
  readonly timeout = 120;

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const startedAt = Date.now();
    const findings: unknown[] = [];
    try {
      const target = new URL(ctx.targetUrl);
      target.searchParams.set('xss', XSS_PAYLOAD);
      const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      const body = await response.text();
      if (body.includes(XSS_PAYLOAD)) {
        findings.push({ url: target.toString(), param: 'xss', payload: XSS_PAYLOAD });
        try {
          await ctx.db('vulnerabilities').insert(withId({
            scan_id: ctx.scanId,
            name: 'Reflected Cross-Site Scripting',
            description: 'The test payload was reflected unencoded in the target response.',
            risk_level: 'high',
            owasp_category: 'A03:2021 - Injection',
            affected_url: target.toString(),
            affected_param: 'xss',
            poc_payload: XSS_PAYLOAD,
          }));
        } catch (error) {
          ctx.logger.error('[XssModule] Failed to persist finding:', error);
        }
      }
      return { status: 'completed', findings, duration: Date.now() - startedAt };
    } catch (error) {
      ctx.logger.error('[XssModule] Target request failed:', error);
      return { status: 'failed', findings, duration: Date.now() - startedAt };
    }
  }
}

const xssModule = new XssModule();
export default xssModule;
registerModule(xssModule);
