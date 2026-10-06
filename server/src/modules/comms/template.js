import sanitizeHtml from "sanitize-html";
import { env } from "../../config/env.js";
import { SystemConfig } from "../../models/index.js";
import { emailHtml } from "./sanitize.js";

/** Placeholders an email body or subject may use, in the order the editor lists them. */
export const PLACEHOLDERS = [
  "userName",
  "userEmail",
  "planName",
  "minutes",
  "loginUrl",
  "supportEmail",
  "appName",
  "inviteLink",
  "inviterName",
  "resetLink",
];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Replaces {{name}} with its value; an unknown or empty name becomes "".
 *
 * `escape` is on for HTML: a person's name is data, not markup, so a name like
 * `<script>` cannot become a tag in the message. Subjects and plain text are
 * filled raw.
 */
export function fill(text, vars, { escape = false } = {}) {
  return String(text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    if (value === undefined || value === null) return "";
    return escape ? escapeHtml(value) : String(value);
  });
}

/** A plain-text version of an HTML body: line breaks kept, tags and entities gone. */
export function htmlToText(html) {
  const withBreaks = String(html ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {}, nonTextTags: ["script", "style", "title"] })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The app's name and support address, from the admin's config when it is set
 * and the environment otherwise - never a name baked into a template.
 */
export async function brand() {
  let configured = {};
  try {
    const rows = await SystemConfig.find({ key: { $in: ["app_name", "support_email"] } }).select("key value").lean();
    configured = Object.fromEntries(rows.filter((r) => r.value).map((r) => [r.key, r.value]));
  } catch {
    // Config is a nicety here; a send must not fail because it could not be read.
  }
  return {
    name: configured.app_name || env.mail.defaultFromName || "Avatar Studio",
    supportEmail: configured.support_email || env.mail.supportEmail || "",
    loginUrl: `${env.clientOrigin.replace(/\/$/, "")}/login`,
  };
}

/** What each recipient's placeholders are filled with. */
export function recipientVars(recipient, appBrand, extra = {}) {
  const email = recipient.email || "";
  return {
    userName: recipient.name || email.split("@")[0] || "there",
    userEmail: email,
    planName: recipient.planName || "Free",
    minutes: recipient.minutes ?? "",
    loginUrl: appBrand.loginUrl,
    supportEmail: appBrand.supportEmail,
    appName: appBrand.name,
    ...extra,
  };
}

/** Example values for the Test buttons, so a template can be checked at a glance. */
export function sampleVars(email, appBrand) {
  return recipientVars(
    { email, name: "Test User", planName: "Pro", minutes: 600 },
    appBrand,
    {
      inviteLink: `${env.clientOrigin.replace(/\/$/, "")}/invite?token=sample`,
      inviterName: "Admin Tester",
      resetLink: `${env.clientOrigin.replace(/\/$/, "")}/reset-password?token=sample`,
    },
  );
}

/** One look for every email: the body, sanitised, inside a small branded frame. */
function shell({ brandName, supportEmail, bodyHtml, preheader }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader || "")}</span>
<div style="max-width:600px;margin:0 auto;padding:24px 12px;">
<div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
<div style="padding:20px 28px;background:#111111;color:#ffffff;font-size:18px;font-weight:700;">${escapeHtml(brandName)}</div>
<div style="padding:28px;font-size:15px;line-height:1.6;">${bodyHtml}</div>
</div>
<p style="text-align:center;font-size:12px;color:#71717a;margin:16px 0 0;">Sent by ${escapeHtml(brandName)}${
    supportEmail ? ` &middot; Questions? ${escapeHtml(supportEmail)}` : ""
  }</p>
</div></body></html>`;
}

/**
 * The finished message for one recipient. Bulk, scheduled and test sends all
 * go through here, so a placeholder means the same thing in each.
 *
 * Substitution comes first and sanitising second: whatever the admin's HTML or
 * the data produced, only safe markup reaches the frame.
 */
export function buildMessage({ subject, html, text, vars, appBrand, fromName }) {
  const body = emailHtml(fill(html, vars, { escape: true }));
  return {
    subject: fill(subject, vars),
    html: shell({
      brandName: appBrand.name,
      supportEmail: appBrand.supportEmail,
      bodyHtml: body,
      preheader: fill(subject, vars),
    }),
    // The admin's own plain text when they wrote one, otherwise the HTML as text.
    text: text ? fill(text, vars) : htmlToText(body),
    fromName: fromName || appBrand.name,
  };
}
