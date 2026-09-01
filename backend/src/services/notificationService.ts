/**
 * Notification Service — EventEmitter-based email notification system.
 *
 * Listens for:
 *  - `scan.completed`      → sends scan completion email
 *  - `vulnerability.critical` → sends immediate critical-finding alert
 *
 * Retry logic: 3 attempts with exponential back-off (1s, 2s, 4s).
 * On exhaustion, writes failure to activity_logs and stops retrying.
 * Respects `email_notif_enabled` flag on user — skips email if false.
 *
 * Requirements: 19.1-19.4
 */

import EventEmitter from 'events';
import nodemailer from 'nodemailer';
import db from '../db';
import { logEvent } from '../utils/activityLog';

// ---------------------------------------------------------------------------
// EventEmitter singleton
// ---------------------------------------------------------------------------

export const scanEventEmitter = new EventEmitter();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanCompletedPayload {
  scanId: string;
  userId: string;
  targetUrl: string;
  completedAt: string;
  totalVulnCount: number;
  criticalVulnCount: number;
}

export interface VulnerabilityCriticalPayload {
  scanId: string;
  userId: string;
  vulnId: string;
  vulnName: string;
  affectedUrl: string | null;
  targetUrl: string;
}

// ---------------------------------------------------------------------------
// Nodemailer transporter factory
// ---------------------------------------------------------------------------

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

const SMTP_FROM = process.env.SMTP_FROM ?? '"WebShield" <no-reply@webshield.local>';

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [1000, 2000, 4000]; // exponential back-off

/**
 * Attempts to send an email up to 3 times with exponential back-off.
 * On final failure, logs to activity_logs and stops.
 */
async function sendWithRetry(
  mailOptions: Parameters<ReturnType<typeof createTransporter>['sendMail']>[0],
  context: { eventType: string; userId: string; resourceId: string },
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      const transporter = createTransporter();
      await transporter.sendMail(mailOptions);
      return; // Success
    } catch (err) {
      lastError = err;
      console.error(
        `[notificationService] Email attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : err,
      );

      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  // All retries exhausted — log to activity_logs (Requirement 19.3)
  await logEvent({
    eventType: 'notification_failure',
    actorUserId: context.userId,
    targetResourceId: context.resourceId,
    targetResourceType: 'scan',
    description: `Email notification (${context.eventType}) failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

interface UserRow {
  email: string;
  display_name: string;
  email_notif_enabled: boolean;
}

async function getUserById(userId: string): Promise<UserRow | null> {
  const user = await db('users')
    .where({ id: userId })
    .first<UserRow | null>(['email', 'display_name', 'email_notif_enabled']);
  return user ?? null;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handles `scan.completed` event.
 * Sends an email with target URL, time, vuln count, critical count.
 *
 * Requirements: 19.1, 19.4
 */
async function handleScanCompleted(payload: ScanCompletedPayload): Promise<void> {
  const user = await getUserById(payload.userId);

  if (!user) {
    console.warn(`[notificationService] User ${payload.userId} not found for scan.completed event.`);
    return;
  }

  // Respect opt-out (Requirement 19.4)
  if (!user.email_notif_enabled) {
    return;
  }

  const subject = `WebShield: Scan completed — ${payload.targetUrl}`;
  const text = [
    `Hi ${user.display_name},`,
    '',
    'Your WebShield security scan has completed.',
    '',
    `Target URL:          ${payload.targetUrl}`,
    `Completed At:        ${payload.completedAt}`,
    `Total Vulnerabilities: ${payload.totalVulnCount}`,
    `Critical Findings:   ${payload.criticalVulnCount}`,
    '',
    'Log in to WebShield to review your results.',
    '',
    '— The WebShield Team',
  ].join('\n');

  const html = `
    <p>Hi ${user.display_name},</p>
    <p>Your WebShield security scan has completed.</p>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px;font-weight:bold">Target URL</td><td>${payload.targetUrl}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Completed At</td><td>${payload.completedAt}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Total Vulnerabilities</td><td>${payload.totalVulnCount}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;color:#ff4757">Critical Findings</td><td><strong>${payload.criticalVulnCount}</strong></td></tr>
    </table>
    <p>Log in to <a href="${process.env.FRONTEND_URL ?? 'http://localhost:5173'}">WebShield</a> to review your results.</p>
    <p>— The WebShield Team</p>
  `;

  await sendWithRetry(
    { from: SMTP_FROM, to: user.email, subject, text, html },
    { eventType: 'scan.completed', userId: payload.userId, resourceId: payload.scanId },
  );
}

/**
 * Handles `vulnerability.critical` event.
 * Sends an immediate alert email.
 *
 * Requirements: 19.2, 19.4
 */
async function handleVulnerabilityCritical(payload: VulnerabilityCriticalPayload): Promise<void> {
  const user = await getUserById(payload.userId);

  if (!user) {
    console.warn(`[notificationService] User ${payload.userId} not found for vulnerability.critical event.`);
    return;
  }

  // Respect opt-out (Requirement 19.4)
  if (!user.email_notif_enabled) {
    return;
  }

  const subject = `⚠️ WebShield: Critical vulnerability found — ${payload.targetUrl}`;
  const text = [
    `Hi ${user.display_name},`,
    '',
    'A CRITICAL vulnerability was discovered in your WebShield scan.',
    '',
    `Target URL:    ${payload.targetUrl}`,
    `Vulnerability: ${payload.vulnName}`,
    `Affected URL:  ${payload.affectedUrl ?? 'N/A'}`,
    '',
    'Immediate action is recommended.',
    '',
    '— The WebShield Team',
  ].join('\n');

  const html = `
    <p>Hi ${user.display_name},</p>
    <p>A <strong style="color:#ff4757">CRITICAL</strong> vulnerability was discovered during your WebShield scan.</p>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 12px;font-weight:bold">Target URL</td><td>${payload.targetUrl}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Vulnerability</td><td>${payload.vulnName}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Affected URL</td><td>${payload.affectedUrl ?? 'N/A'}</td></tr>
    </table>
    <p>Immediate action is recommended. Log in to <a href="${process.env.FRONTEND_URL ?? 'http://localhost:5173'}">WebShield</a> to review.</p>
    <p>— The WebShield Team</p>
  `;

  await sendWithRetry(
    { from: SMTP_FROM, to: user.email, subject, text, html },
    { eventType: 'vulnerability.critical', userId: payload.userId, resourceId: payload.vulnId },
  );
}

// ---------------------------------------------------------------------------
// Register listeners
// ---------------------------------------------------------------------------

scanEventEmitter.on('scan.completed', (payload: ScanCompletedPayload) => {
  handleScanCompleted(payload).catch((err) => {
    console.error('[notificationService] Unhandled error in handleScanCompleted:', err);
  });
});

scanEventEmitter.on('vulnerability.critical', (payload: VulnerabilityCriticalPayload) => {
  handleVulnerabilityCritical(payload).catch((err) => {
    console.error('[notificationService] Unhandled error in handleVulnerabilityCritical:', err);
  });
});
