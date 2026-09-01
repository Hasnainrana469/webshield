/**
 * Email service — wraps Nodemailer for sending transactional emails.
 * Configuration is driven entirely by environment variables (SMTP_*).
 */

import nodemailer from 'nodemailer';

/** Creates a Nodemailer transporter from environment variables. */
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export interface SendPasswordResetEmailOptions {
  toEmail: string;
  displayName: string;
  rawToken: string;
  frontendUrl: string;
}

/**
 * Sends a password reset email containing a one-time link.
 * The link embeds the raw (un-hashed) token as a query parameter.
 *
 * @throws if Nodemailer fails to send.
 */
export async function sendPasswordResetEmail(
  options: SendPasswordResetEmailOptions
): Promise<void> {
  const { toEmail, displayName, rawToken, frontendUrl } = options;

  const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? `"WebShield" <no-reply@webshield.local>`,
    to: toEmail,
    subject: 'Reset your WebShield password',
    text: [
      `Hi ${displayName},`,
      '',
      'We received a request to reset the password for your WebShield account.',
      '',
      `Use the link below to set a new password. This link is valid for 1 hour.`,
      '',
      resetLink,
      '',
      'If you did not request a password reset, you can safely ignore this email.',
      '',
      '— The WebShield Team',
    ].join('\n'),
    html: `
      <p>Hi ${displayName},</p>
      <p>We received a request to reset the password for your WebShield account.</p>
      <p>Use the link below to set a new password. This link is valid for <strong>1 hour</strong>.</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>If you did not request a password reset, you can safely ignore this email.</p>
      <p>— The WebShield Team</p>
    `,
  });
}
