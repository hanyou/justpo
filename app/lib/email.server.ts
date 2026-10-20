/**
 * Resend email helper — sends the PO PDF to the supplier.
 *
 * When RESEND_API_KEY is not set, the email is NOT sent: we log a clear
 * message and return { sent: false, reason }. Callers keep the PO in
 * "sent" status and show the user a red warning + retry button (PRD §6.5).
 */
import { Resend } from "resend";
import type { Env } from "../../env";

export interface SendPOResult {
  sent: boolean;
  messageId?: string;
  reason?: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: Array<{ filename: string; content: string }>; // base64 content
}

/** Generic email send. Returns { sent: false } with a clear log when unconfigured. */
export async function sendEmail(env: Env, opts: EmailOptions): Promise<SendPOResult> {
  if (!env.RESEND_API_KEY) {
    console.warn(
      `[justpo] RESEND_API_KEY is not set — skipping email to ${opts.to} ` +
        `("${opts.subject}"). Set it via \`wrangler secret put RESEND_API_KEY\` (or .dev.vars locally).`
    );
    return { sent: false, reason: "RESEND_API_KEY is not configured" };
  }
  if (!opts.to) {
    console.warn(`[justpo] no recipient — skipping email "${opts.subject}"`);
    return { sent: false, reason: "no recipient" };
  }

  const from = env.RESEND_FROM_EMAIL ?? "JustPO <po@justpo.app>";
  const resend = new Resend(env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.htmlBody,
    ...(opts.attachments ? { attachments: opts.attachments } : {}),
  });

  if (error) {
    console.error(`[justpo] Resend failed for ${opts.to}:`, error.message);
    return { sent: false, reason: error.message };
  }
  return { sent: true, messageId: data?.id };
}

/**
 * Escape HTML-significant chars before interpolating user/data-supplied text
 * (supplier names, product titles) into email bodies, so a `&`, `<` or `"`
 * can't break the markup. Not a security boundary — just correct rendering.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Base64-encode bytes without Node Buffer (Workers-safe). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function sendPOEmail(
  env: Env,
  opts: {
    to: string;
    subject: string;
    htmlBody: string;
    pdfBytes: Uint8Array;
    pdfFilename: string;
  }
): Promise<SendPOResult> {
  if (!env.RESEND_API_KEY) {
    console.warn(
      `[justpo] RESEND_API_KEY is not set — skipping PO email to ${opts.to}. ` +
        `Set it via \`wrangler secret put RESEND_API_KEY\` (or .dev.vars locally).`
    );
    return { sent: false, reason: "RESEND_API_KEY is not configured" };
  }

  return sendEmail(env, {
    to: opts.to,
    subject: opts.subject,
    htmlBody: opts.htmlBody,
    attachments: [
      { filename: opts.pdfFilename, content: bytesToBase64(opts.pdfBytes) },
    ],
  });
}
