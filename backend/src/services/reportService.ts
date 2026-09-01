/**
 * Report Generator service — produces PDF and HTML reports from completed scans.
 *
 * Uses Puppeteer to render an HTML template to PDF.
 * Screenshot assets captured during crawling are embedded as base64.
 * Persists Report records and writes Activity_Log on completion or failure.
 *
 * Requirements: 16.1-16.6
 */

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import db, { withId } from '../db';
import { logEvent } from '../utils/activityLog';
import type { VulnerabilityRecord } from './scanService';
import { generateExecutiveSummary } from './aiService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportResult {
  report_id: string;
  pdf_url: string;
  html_url: string;
}

interface ScanRow {
  id: string;
  target_url: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPORTS_DIR = process.env.REPORTS_DIR ?? path.join(process.cwd(), 'reports');

/** Ensures the reports directory exists. */
function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

/** Converts a file to a base64 data-URI, or returns empty string if not found. */
function fileToBase64DataUri(filePath: string): string {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    const data = fs.readFileSync(filePath).toString('base64');
    return `data:${mime};base64,${data}`;
  } catch {
    return '';
  }
}

/** Formats a duration in seconds to a human-readable string. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/** Risk level badge colour map */
const RISK_COLOURS: Record<string, string> = {
  critical: '#ff4757',
  high: '#ff6348',
  medium: '#ffa502',
  low: '#2ed573',
  informational: '#747d8c',
};

// ---------------------------------------------------------------------------
// HTML template builder
// ---------------------------------------------------------------------------

function buildHtmlReport(
  scan: ScanRow,
  vulns: VulnerabilityRecord[],
  executiveSummary: string,
): string {
  const scanDate = new Date(scan.created_at).toLocaleString();
  const durationSeconds =
    scan.started_at && scan.completed_at
      ? Math.round(
          (new Date(scan.completed_at).getTime() - new Date(scan.started_at).getTime()) / 1000,
        )
      : null;

  // Risk summary counts
  const riskCounts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  vulns.forEach((v) => {
    if (v.risk_level in riskCounts) {
      (riskCounts as Record<string, number>)[v.risk_level]++;
    }
  });

  // OWASP breakdown
  const owaspMap: Record<string, number> = {};
  vulns.forEach((v) => {
    owaspMap[v.owasp_category] = (owaspMap[v.owasp_category] ?? 0) + 1;
  });

  const owaspRows = Object.entries(owaspMap)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([cat, count]) =>
        `<tr><td>${escHtml(cat)}</td><td>${count}</td></tr>`,
    )
    .join('');

  // Vulnerability findings table
  const vulnTableRows = vulns
    .map(
      (v) => `
        <tr>
          <td>${escHtml(v.name)}</td>
          <td><span class="badge" style="background:${RISK_COLOURS[v.risk_level] ?? '#747d8c'}">${escHtml(v.risk_level)}</span></td>
          <td>${escHtml(v.owasp_category)}</td>
          <td>${v.ai_score != null ? v.ai_score.toFixed(1) : 'N/A'}</td>
          <td>${escHtml(v.affected_url ?? '')}</td>
        </tr>`,
    )
    .join('');

  // Per-vulnerability detail sections
  const vulnDetails = vulns
    .map((v) => {
      const screenshot = v.screenshot_path ? fileToBase64DataUri(v.screenshot_path) : '';
      return `
      <div class="vuln-detail">
        <h3>${escHtml(v.name)}</h3>
        <p><strong>Risk Level:</strong> <span class="badge" style="background:${RISK_COLOURS[v.risk_level] ?? '#747d8c'}">${escHtml(v.risk_level)}</span></p>
        <p><strong>OWASP Category:</strong> ${escHtml(v.owasp_category)}</p>
        ${v.affected_url ? `<p><strong>Affected URL:</strong> <code>${escHtml(v.affected_url)}</code></p>` : ''}
        ${v.affected_param ? `<p><strong>Affected Parameter:</strong> <code>${escHtml(v.affected_param)}</code></p>` : ''}
        ${v.description ? `<p><strong>Description:</strong> ${escHtml(v.description)}</p>` : ''}
        ${v.ai_description ? `<p><strong>AI Analysis:</strong> ${escHtml(v.ai_description)}</p>` : ''}
        ${v.poc_payload ? `<p><strong>PoC Payload:</strong> <code>${escHtml(v.poc_payload)}</code></p>` : ''}
        ${v.ai_remediation ? `<p><strong>Remediation:</strong> ${escHtml(v.ai_remediation)}</p>` : ''}
        ${screenshot ? `<p><strong>Screenshot:</strong><br><img src="${screenshot}" style="max-width:100%;border:1px solid #ccc;" /></p>` : ''}
      </div>`;
    })
    .join('<hr>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WebShield Security Report — ${escHtml(scan.target_url)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #222; margin: 0; padding: 0; }
  .cover { background: #0a0f1e; color: #fff; padding: 60px 40px; page-break-after: always; }
  .cover h1 { font-size: 2.5rem; margin-bottom: 8px; }
  .cover p { font-size: 1.1rem; color: #aaa; }
  .section { padding: 30px 40px; }
  h2 { color: #0a0f1e; border-bottom: 2px solid #00d4ff; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #0a0f1e; color: #fff; padding: 8px 12px; text-align: left; }
  td { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .badge { display:inline-block; padding: 2px 8px; border-radius: 4px; color: #fff; font-size: 0.85rem; text-transform: capitalize; }
  .vuln-detail { margin: 20px 0; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9rem; word-break: break-all; }
  .risk-summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .risk-card { padding: 16px 24px; border-radius: 8px; color: #fff; text-align: center; min-width: 100px; }
  .risk-card .count { font-size: 2rem; font-weight: bold; }
  .risk-card .label { font-size: 0.85rem; text-transform: capitalize; }
  pre { white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>

<!-- Cover Page -->
<div class="cover">
  <h1>🛡️ WebShield Security Report</h1>
  <p><strong>Target:</strong> ${escHtml(scan.target_url)}</p>
  <p><strong>Scan Date:</strong> ${scanDate}</p>
  ${durationSeconds != null ? `<p><strong>Duration:</strong> ${formatDuration(durationSeconds)}</p>` : ''}
  <p><strong>Total Vulnerabilities:</strong> ${vulns.length}</p>
  <p><strong>Status:</strong> ${escHtml(scan.status)}</p>
</div>

<!-- Executive Summary -->
<div class="section">
  <h2>Executive Summary</h2>
  <pre>${escHtml(executiveSummary)}</pre>
</div>

<!-- Risk Summary -->
<div class="section">
  <h2>Risk Summary</h2>
  <div class="risk-summary">
    ${Object.entries(riskCounts).map(([level, count]) => `
      <div class="risk-card" style="background:${RISK_COLOURS[level] ?? '#747d8c'}">
        <div class="count">${count}</div>
        <div class="label">${level}</div>
      </div>`).join('')}
  </div>
</div>

<!-- OWASP Breakdown -->
<div class="section">
  <h2>OWASP Category Breakdown</h2>
  <table>
    <thead><tr><th>OWASP Category</th><th>Count</th></tr></thead>
    <tbody>${owaspRows}</tbody>
  </table>
</div>

<!-- Vulnerability Findings Table -->
<div class="section">
  <h2>Vulnerability Findings (${vulns.length} total)</h2>
  <table>
    <thead>
      <tr>
        <th>Name</th><th>Risk Level</th><th>OWASP Category</th><th>AI Score</th><th>Affected URL</th>
      </tr>
    </thead>
    <tbody>${vulnTableRows}</tbody>
  </table>
</div>

<!-- Per-Vulnerability Details -->
<div class="section">
  <h2>Vulnerability Details</h2>
  ${vulnDetails}
</div>

<!-- Appendix -->
<div class="section">
  <h2>Appendix</h2>
  <p>Report generated by WebShield on ${new Date().toISOString()}.</p>
  <p>Scan ID: ${escHtml(scan.id)}</p>
</div>

</body>
</html>`;
}

/** Escapes HTML special characters. */
function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Main service function
// ---------------------------------------------------------------------------

const REPORT_TIMEOUT_MS = 60_000; // 60 seconds (Requirement 16.4, 16.5)

/**
 * Generates PDF and HTML reports for a completed scan.
 * Returns { report_id, pdf_url, html_url }.
 *
 * @throws Error with message "REPORT_TIMEOUT" if generation exceeds 60 seconds.
 *
 * Requirements: 16.1-16.6
 */
export async function generateReport(
  scanId: string,
  userId: string,
): Promise<ReportResult> {
  ensureReportsDir();

  // Fetch scan
  const scan = await db('scans')
    .where({ id: scanId, user_id: userId })
    .first<ScanRow>(['id', 'target_url', 'status', 'started_at', 'completed_at', 'created_at']);

  if (!scan) {
    throw new Error('Scan not found.');
  }

  // Fetch all vulnerabilities sorted by ai_score desc
  const vulns = await db('vulnerabilities')
    .where({ scan_id: scanId })
    .orderByRaw('ai_score DESC NULLS LAST')
    .select<VulnerabilityRecord[]>([
      'id', 'scan_id', 'name', 'description', 'risk_level', 'owasp_category',
      'affected_url', 'affected_param', 'poc_payload', 'screenshot_path',
      'ai_score', 'ai_description', 'ai_remediation', 'discovered_at',
    ]);

  // Generate executive summary (will use fallback if AI unavailable)
  const executiveSummary = await generateExecutiveSummary(scanId, vulns);

  // Build HTML
  const htmlContent = buildHtmlReport(scan, vulns, executiveSummary);

  const timestamp = Date.now();
  const htmlFileName = `report_${scanId}_${timestamp}.html`;
  const pdfFileName = `report_${scanId}_${timestamp}.pdf`;
  const htmlFilePath = path.join(REPORTS_DIR, htmlFileName);
  const pdfFilePath = path.join(REPORTS_DIR, pdfFileName);

  // Write HTML file
  fs.writeFileSync(htmlFilePath, htmlContent, 'utf8');
  const htmlFileSize = fs.statSync(htmlFilePath).size;

  // Persist HTML report record
  const htmlReportId = uuidv4();
  await db('reports').insert({
    id: htmlReportId,
    scan_id: scanId,
    format: 'html',
    file_path: htmlFilePath,
    file_size_bytes: htmlFileSize,
  });

  // Generate PDF with timeout
  let pdfFileSize = 0;
  let pdfReportId: string | null = null;

  try {
    await Promise.race([
      (async () => {
        const browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        try {
          const page = await browser.newPage();
          await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
          await page.pdf({ path: pdfFilePath, format: 'A4', printBackground: true });
        } finally {
          await browser.close();
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('REPORT_TIMEOUT')), REPORT_TIMEOUT_MS),
      ),
    ]);

    pdfFileSize = fs.statSync(pdfFilePath).size;

    // Persist PDF report record
    const newPdfId = uuidv4();
    await db('reports').insert({
      id: newPdfId,
      scan_id: scanId,
      format: 'pdf',
      file_path: pdfFilePath,
      file_size_bytes: pdfFileSize,
    });

    pdfReportId = newPdfId;
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'REPORT_TIMEOUT';

    await logEvent({
      eventType: 'report_generation',
      actorUserId: userId,
      targetResourceId: scanId,
      targetResourceType: 'scan',
      description: isTimeout
        ? `PDF report generation timed out after 60 seconds for scan ${scanId}.`
        : `PDF report generation failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`,
    });

    if (isTimeout) {
      throw new Error('REPORT_TIMEOUT');
    }

    throw err;
  }

  // Write Activity_Log for report_generation
  await logEvent({
    eventType: 'report_generation',
    actorUserId: userId,
    targetResourceId: scanId,
    targetResourceType: 'scan',
    description: `Report generated for scan ${scanId} (PDF and HTML).`,
  });

  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';

  return {
    report_id: pdfReportId ?? htmlReportId,
    pdf_url: `${baseUrl}/api/v1/reports/${pdfReportId}/download/pdf`,
    html_url: `${baseUrl}/api/v1/reports/${htmlReportId}/download/html`,
  };
}
