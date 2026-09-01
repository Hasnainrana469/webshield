/**
 * PortScanModule — discovers open ports and exposed services via Nmap.
 *
 * Spawns: nmap -sV --open -T4 -oX - <host>
 * Parses the XML output stream using fast-xml-parser.
 *
 * Risk assignment:
 *  - Port 21 (FTP), 23 (Telnet), 3306 (MySQL), 5432 (PostgreSQL), 27017 (MongoDB) → High
 *  - All other open ports → Low
 *
 * Enforces a 300-second timeout on the Nmap process.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 * OWASP: A05:2021 – Security Misconfiguration
 */

import { spawn } from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import { ScanModule, ScanContext, ModuleResult, registerModule } from '../services/scanOrchestrator';
import { withId } from '../db';

const OWASP_CATEGORY = 'A05:2021 – Security Misconfiguration';

/** Nmap execution timeout in milliseconds (300 seconds per Requirement 7.5). */
const NMAP_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// High-risk port definitions
// ---------------------------------------------------------------------------

interface HighRiskPort {
  port: number;
  service: string;
  description: string;
}

const HIGH_RISK_PORTS: HighRiskPort[] = [
  {
    port: 21,
    service: 'FTP',
    description:
      'FTP (port 21) transmits credentials and data in plain text, making it susceptible ' +
      'to credential theft and data interception. Replace with SFTP or FTPS.',
  },
  {
    port: 23,
    service: 'Telnet',
    description:
      'Telnet (port 23) provides unauthenticated, unencrypted remote access and should be ' +
      'disabled immediately. Use SSH instead.',
  },
  {
    port: 3306,
    service: 'MySQL',
    description:
      'MySQL (port 3306) is publicly accessible, allowing direct database attacks including ' +
      'brute-force and exploitation of vulnerabilities. Restrict access to trusted IP ranges ' +
      'or bind the service to localhost only.',
  },
  {
    port: 5432,
    service: 'PostgreSQL',
    description:
      'PostgreSQL (port 5432) is publicly accessible, exposing the database to remote attacks. ' +
      'Restrict network access using firewall rules and bind to localhost or a private network interface.',
  },
  {
    port: 27017,
    service: 'MongoDB',
    description:
      'MongoDB (port 27017) is publicly accessible. Historically, many MongoDB instances have ' +
      'been compromised when exposed to the internet. Enable authentication and restrict network access.',
  },
];

const HIGH_RISK_PORT_MAP = new Map<number, HighRiskPort>(
  HIGH_RISK_PORTS.map((p) => [p.port, p]),
);

// ---------------------------------------------------------------------------
// Nmap XML parsing helpers
// ---------------------------------------------------------------------------

interface ParsedPort {
  portNumber: number;
  protocol: string;
  state: string;
  serviceName: string;
  serviceVersion: string;
  serviceProduct: string;
}

/**
 * Parses Nmap XML output and returns a list of open port records.
 */
function parseNmapXml(xml: string): ParsedPort[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['port', 'host'].includes(name),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const nmaprun = parsed['nmaprun'] as Record<string, unknown> | undefined;
  if (!nmaprun) return [];

  const hosts = nmaprun['host'];
  if (!Array.isArray(hosts) || hosts.length === 0) return [];

  const openPorts: ParsedPort[] = [];

  for (const host of hosts as Record<string, unknown>[]) {
    const portsSection = host['ports'] as Record<string, unknown> | undefined;
    if (!portsSection) continue;

    const ports = portsSection['port'];
    if (!ports) continue;

    const portList = Array.isArray(ports) ? ports : [ports];

    for (const port of portList as Record<string, unknown>[]) {
      const stateObj = port['state'] as Record<string, unknown> | undefined;
      const state = stateObj ? String(stateObj['@_state'] ?? '') : '';

      if (state !== 'open') continue;

      const portNum = parseInt(String(port['@_portid'] ?? '0'), 10);
      const protocol = String(port['@_protocol'] ?? 'tcp');

      const serviceObj = port['service'] as Record<string, unknown> | undefined;
      const serviceName = serviceObj ? String(serviceObj['@_name'] ?? 'unknown') : 'unknown';
      const serviceProduct = serviceObj ? String(serviceObj['@_product'] ?? '') : '';
      const serviceVersion = serviceObj ? String(serviceObj['@_version'] ?? '') : '';

      openPorts.push({
        portNumber: portNum,
        protocol,
        state,
        serviceName,
        serviceVersion,
        serviceProduct,
      });
    }
  }

  return openPorts;
}

// ---------------------------------------------------------------------------
// Nmap spawner
// ---------------------------------------------------------------------------

interface NmapRunResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  exitCode: number | null;
}

function runNmap(host: string): Promise<NmapRunResult> {
  return new Promise((resolve) => {
    const args = ['-sV', '--open', '-T4', '-oX', '-', host];
    const proc = spawn('nmap', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, NMAP_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, exitCode: code });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      // Nmap not installed or permission issue
      resolve({ stdout: '', stderr: err.message, timedOut: false, exitCode: null });
    });
  });
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class PortScanModule implements ScanModule {
  readonly name = 'port_scan';
  readonly timeout = 360; // slightly above nmap's 300s to allow for process overhead

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const findings: unknown[] = [];

    const { scanId, targetUrl, db, logger } = ctx;

    logger.log(`[PortScanModule] Starting port scan for ${targetUrl}`);

    // Extract hostname from target URL
    let hostname: string;
    try {
      const parsed = new URL(targetUrl);
      hostname = parsed.hostname;
    } catch {
      logger.error(`[PortScanModule] Invalid target URL: ${targetUrl}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    // Run nmap
    logger.log(`[PortScanModule] Executing: nmap -sV --open -T4 -oX - ${hostname}`);
    const result = await runNmap(hostname);

    if (result.timedOut) {
      logger.warn(`[PortScanModule] Nmap timed out after ${NMAP_TIMEOUT_MS / 1000}s`);
      return {
        status: 'timed_out',
        findings,
        duration: Date.now() - start,
      };
    }

    if (!result.stdout || result.stdout.trim() === '') {
      const errMsg = result.stderr || 'No output from nmap.';
      logger.error(`[PortScanModule] Nmap produced no output. Error: ${errMsg}`);
      return { status: 'failed', findings, duration: Date.now() - start };
    }

    // Parse the XML output
    const openPorts = parseNmapXml(result.stdout);
    logger.log(`[PortScanModule] Found ${openPorts.length} open port(s).`);

    // Persist each open port as a vulnerability / finding
    for (const port of openPorts) {
      const highRisk = HIGH_RISK_PORT_MAP.get(port.portNumber);
      const riskLevel: 'high' | 'low' = highRisk ? 'high' : 'low';

      const serviceLabel = [port.serviceProduct, port.serviceName, port.serviceVersion]
        .filter(Boolean)
        .join(' ') || 'Unknown Service';

      const finding = {
        port: port.portNumber,
        protocol: port.protocol,
        service: serviceLabel,
        riskLevel,
      };
      findings.push(finding);

      // Requirement 7.2 — persist each open port as a structured finding
      // Requirement 7.3 — create Vulnerability record for high-risk ports
      // We create a vulnerability record for ALL open ports:
      //   High-risk ones get risk_level 'high', others get 'low'
      const name = highRisk
        ? `Exposed High-Risk Service: ${highRisk.service} (Port ${port.portNumber}/${port.protocol})`
        : `Open Port Discovered: ${port.portNumber}/${port.protocol} (${serviceLabel})`;

      const description = highRisk
        ? highRisk.description
        : `An open port was discovered at ${hostname}:${port.portNumber}/${port.protocol} ` +
          `running service "${serviceLabel}". Review whether this service is intentionally ` +
          `exposed and apply appropriate firewall rules or access controls.`;

      try {
        await db('vulnerabilities').insert(withId({
          scan_id: scanId,
          name,
          description,
          risk_level: riskLevel,
          owasp_category: OWASP_CATEGORY,
          affected_url: `nmap://${hostname}:${port.portNumber}`,
          affected_param: `${port.portNumber}/${port.protocol}`,
          poc_payload: `nmap -sV --open ${hostname}`,
        }));
      } catch (dbErr) {
        logger.error(
          `[PortScanModule] DB insert failed for port ${port.portNumber}/${port.protocol}:`,
          dbErr,
        );
      }
    }

    const duration = Date.now() - start;
    logger.log(`[PortScanModule] Completed in ${duration}ms.`);

    return { status: 'completed', findings, duration };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const portScanModule = new PortScanModule();
export default portScanModule;
registerModule(portScanModule);
