/** TLS certificate and protocol scanner. */

import * as tls from 'tls';
import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const OWASP_CATEGORY = 'A02:2021 - Cryptographic Failures';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 10_000;

interface TlsCheckResult {
  connected: boolean;
  certificate: tls.PeerCertificate | null;
  protocol: string | null;
  error?: string;
}

function checkTls(hostname: string, port: number): Promise<TlsCheckResult> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: false,
      timeout: CONNECT_TIMEOUT_MS,
    }, () => {
      const certificate = socket.getPeerCertificate(false);
      const protocol = socket.getProtocol ? socket.getProtocol() : null;
      socket.destroy();
      resolve({
        connected: true,
        certificate: certificate && Object.keys(certificate).length > 0 ? certificate : null,
        protocol,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ connected: false, certificate: null, protocol: null, error: 'TLS connection timed out.' });
    });
    socket.on('error', (error) => {
      socket.destroy();
      resolve({ connected: false, certificate: null, protocol: null, error: error.message });
    });
  });
}

class SslTlsModule implements ScanModule {
  readonly name = 'ssl_tls';
  readonly timeout = 60;

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];
    const { targetUrl, logger } = ctx;
    let parsed: URL;

    try {
      parsed = new URL(targetUrl);
    } catch {
      logger.error(`[SslTlsModule] Invalid target URL: ${targetUrl}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    const tlsResult = await checkTls(parsed.hostname, parsed.port ? parseInt(parsed.port, 10) : 443);
    if (!tlsResult.connected) {
      if (parsed.protocol !== 'https:') {
        findings.push({ check: 'no_https', risk: 'high' });
        await this.insertFinding(ctx, {
          name: 'No HTTPS Available',
          description: 'The target is served over plain HTTP without an HTTPS alternative. Enable HTTPS and redirect all HTTP traffic to the HTTPS endpoint.',
          risk_level: 'high',
          affected_url: targetUrl,
        });
      } else {
        findings.push({ check: 'tls_connect_failed', error: tlsResult.error });
        await this.insertFinding(ctx, {
          name: 'TLS Connection Failed',
          description: `Unable to establish a TLS connection to ${parsed.hostname}. Error: ${tlsResult.error ?? 'unknown'}.`,
          risk_level: 'high',
          affected_url: targetUrl,
        });
      }
    } else {
      if (parsed.protocol !== 'https:') {
        findings.push({ check: 'http_no_redirect', risk: 'high' });
        await this.insertFinding(ctx, {
          name: 'HTTP Without HTTPS Redirect',
          description: 'The target is served over plain HTTP and does not automatically redirect to HTTPS. Configure a permanent 301 redirect and enable HSTS.',
          risk_level: 'high',
          affected_url: targetUrl,
        });
      }
      await this.evaluateCertificate(tlsResult, ctx, targetUrl, findings);
    }

    const duration = Date.now() - start;
    logger.log(`[SslTlsModule] Completed in ${duration}ms. Found ${findings.length} issue(s).`);
    return { status: 'completed', findings, duration };
  }

  private async evaluateCertificate(
    tlsResult: TlsCheckResult,
    ctx: ScanContext,
    targetUrl: string,
    findings: unknown[],
  ): Promise<void> {
    const cert = tlsResult.certificate;
    if (cert?.valid_to) {
      const msUntilExpiry = new Date(cert.valid_to).getTime() - Date.now();
      if (msUntilExpiry < 0) {
        findings.push({ check: 'cert_expired', risk: 'high', expiredAt: cert.valid_to });
        await this.insertFinding(ctx, {
          name: 'TLS Certificate Expired',
          description: `The TLS certificate for ${new URL(targetUrl).hostname} expired on ${cert.valid_to}. Renew the certificate immediately.`,
          risk_level: 'high',
          affected_url: targetUrl,
          poc_payload: `Certificate valid_to: ${cert.valid_to}`,
        });
      } else if (msUntilExpiry < THIRTY_DAYS_MS) {
        const daysRemaining = Math.floor(msUntilExpiry / (24 * 60 * 60 * 1000));
        findings.push({ check: 'cert_expiring_soon', risk: 'medium', expiresAt: cert.valid_to, daysRemaining });
        await this.insertFinding(ctx, {
          name: 'TLS Certificate Expiring Soon',
          description: `The TLS certificate for ${new URL(targetUrl).hostname} expires on ${cert.valid_to} (${daysRemaining} days remaining). Plan an immediate renewal.`,
          risk_level: 'medium',
          affected_url: targetUrl,
          poc_payload: `Certificate valid_to: ${cert.valid_to}`,
        });
      }
    }

    if (tlsResult.protocol === 'TLSv1' || tlsResult.protocol === 'TLSv1.1') {
      findings.push({ check: 'weak_tls_version', protocol: tlsResult.protocol, risk: 'medium' });
      await this.insertFinding(ctx, {
        name: `Weak TLS Protocol Version (${tlsResult.protocol})`,
        description: `The server negotiated ${tlsResult.protocol}, which is cryptographically weak. Require TLS 1.2 or TLS 1.3 and disable TLS 1.0 and 1.1.`,
        risk_level: 'medium',
        affected_url: targetUrl,
        poc_payload: `Negotiated protocol: ${tlsResult.protocol}`,
      });
    }
  }

  private async insertFinding(
    ctx: ScanContext,
    finding: { name: string; description: string; risk_level: 'high' | 'medium'; affected_url: string; poc_payload?: string },
  ): Promise<void> {
    try {
      await ctx.db('vulnerabilities').insert(withId({
        scan_id: ctx.scanId,
        ...finding,
        owasp_category: OWASP_CATEGORY,
      }));
    } catch (error) {
      ctx.logger.error('[SslTlsModule] DB insert failed:', error);
    }
  }
}

const sslTlsModule = new SslTlsModule();
export default sslTlsModule;
registerModule(sslTlsModule);