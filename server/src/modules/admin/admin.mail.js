import { env } from "../../config/env.js";

/**
 * The emails the admin screens send: a shared shell, and the plan-update
 * notice. Plain inline-styled HTML, because mail clients ignore everything
 * else. Anything an admin or user typed goes through `escapeHtml`.
 */

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The product's name as it appears in mail. */
export const brandName = () => env.mail.defaultFromName;

/** Where the web app lives, with no trailing slash. */
export const webOrigin = () => env.clientOrigin.replace(/\/+$/, "");

/**
 * @param {{ heading: string, intro: string, facts?: Array<{label: string, value: string}>,
 *           button?: { href: string, label: string }, note?: string }} content
 * @returns {{ html: string, text: string }}
 */
export function emailShell({ heading, intro, facts = [], button, note }) {
  const brand = brandName();
  const support = env.mail.supportEmail;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:24px 0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,0.10);">
    <div style="background:#111111;color:#ffffff;padding:32px 24px;text-align:center;">
      <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#ff7ab8;">${escapeHtml(brand)}</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;">${escapeHtml(heading)}</h1>
    </div>
    <div style="padding:32px 30px;">
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${
        facts.length
          ? `<div style="background:#f8f8f6;border:1px solid rgba(0,0,0,0.08);padding:16px 20px;border-radius:10px;margin:0 0 24px;">${facts
              .map((f) => `<p style="margin:6px 0;"><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}</p>`)
              .join("")}</div>`
          : ""
      }
      ${
        button
          ? `<p style="text-align:center;margin:0 0 24px;"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#111111;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(button.label)}</a></p>`
          : ""
      }
      ${note ? `<p style="margin:0 0 20px;font-size:13px;color:#5a5a5a;">${escapeHtml(note)}</p>` : ""}
      ${button ? `<p style="margin:0;font-size:12px;color:#5a5a5a;word-break:break-all;">${escapeHtml(button.href)}</p>` : ""}
    </div>
    <div style="background:#f8f8f6;padding:16px;text-align:center;font-size:12px;color:#6b7280;">
      <p style="margin:4px 0;">&copy; ${new Date().getFullYear()} ${escapeHtml(brand)}</p>
      ${support ? `<p style="margin:4px 0;">Need help? ${escapeHtml(support)}</p>` : ""}
    </div>
  </div>
</body>
</html>`;

  const text = [
    heading,
    "",
    intro,
    ...(facts.length ? ["", ...facts.map((f) => `${f.label}: ${f.value}`)] : []),
    ...(button ? ["", `${button.label}: ${button.href}`] : []),
    ...(note ? ["", note] : []),
    ...(support ? ["", `Need help? ${support}`] : []),
  ].join("\n");

  return { html, text };
}

/** Sent when an admin moves someone to a different plan. */
export function planUpdateEmail({ name, planName, planMinutes, bonusMinutes }) {
  const brand = brandName();
  const shell = emailShell({
    heading: "Your plan has been updated",
    intro: `Hi ${name || "there"}, your ${brand} account has been updated by our team. Everything below is live on your account now.`,
    facts: [
      { label: "Plan", value: planName },
      { label: "Included minutes", value: planMinutes > 0 ? `${planMinutes} per month` : "No monthly cap" },
      ...(bonusMinutes > 0 ? [{ label: "Bonus minutes", value: String(bonusMinutes) }] : []),
    ],
    button: { href: webOrigin(), label: `Open ${brand}` },
  });
  return { subject: `Your ${brand} plan has been updated`, ...shell };
}
