import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Sends one email through Resend's HTTP API.
 *
 * Returns `{ ok, id?, error? }` instead of throwing, so callers decide what a
 * failed send means (an invitation still exists; a bulk send carries on with
 * the next recipient). With no RESEND_API_KEY it returns
 * `{ ok: false, error: "Email is not configured" }` - features that email
 * people degrade to showing the link or the failure, they do not crash.
 *
 * One message per recipient, always: a shared `to` list would show every
 * recipient's address to every other.
 *
 * @param {{ to: string, subject: string, html?: string, text?: string,
 *           fromName?: string, replyTo?: string }} message
 */
export async function sendEmail({ to, subject, html, text, fromName, replyTo }) {
  const { resendApiKey, fromEmail, defaultFromName, supportEmail } = env.mail;
  if (!resendApiKey || !fromEmail) return { ok: false, error: "Email is not configured" };
  if (!to || !subject || (!html && !text)) return { ok: false, error: "to, subject and a body are required" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: `${(fromName || defaultFromName).replace(/[<>"]/g, "")} <${fromEmail}>`,
        to: [to],
        subject,
        ...(html && { html }),
        ...(text && { text }),
        reply_to: replyTo || supportEmail || undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.message || `Email provider answered ${res.status}` };
    return { ok: true, id: body.id };
  } catch (err) {
    logger.warn({ err: err.message }, "email send failed");
    return { ok: false, error: err.message };
  }
}

export const mailConfigured = () => Boolean(env.mail.resendApiKey && env.mail.fromEmail);
