import crypto from "node:crypto";
import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { SupportEmail } from "../../models/index.js";
import { asyncHandler } from "../../middleware/validate.js";
import { emailHtml } from "./sanitize.js";

/**
 * Inbound email webhook for the support mailbox. Mounted at /api/inbound.
 *
 * Configure the mail provider (Resend: Inbound) to POST each received email to
 *   <API address>/api/inbound/email?token=<INBOUND_EMAIL_TOKEN>
 */
const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: { message: "Too many requests." } },
});

/** Constant-time comparison, so response timing does not leak how much of a guess matched. */
const sameToken = (given, expected) => {
  const hash = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
};

const first = (...values) => values.find((v) => typeof v === "string" && v) || "";

/** "Name <a@b.c>" or a bare address, split into its parts. */
function parseFrom(raw) {
  const match = String(raw || "").match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].trim(), email: match[2].trim() } : { name: "", email: String(raw || "").trim() };
}

/** Headers arrive as an object or as a list of {name, value}. */
function headerLookup(headers, key) {
  const k = key.toLowerCase();
  if (Array.isArray(headers)) return headers.find((h) => String(h?.name || h?.key || "").toLowerCase() === k)?.value || "";
  if (headers && typeof headers === "object") {
    const hit = Object.entries(headers).find(([name]) => name.toLowerCase() === k);
    return hit ? String(hit[1]) : "";
  }
  return "";
}

/**
 * Resend's "received" webhook carries the headers but not the body; the body is
 * fetched with the API key. A body past the provider's retention window is
 * simply gone, and the message is still stored with its subject and sender.
 */
async function fetchBody(emailId) {
  if (!env.mail.resendApiKey || !emailId) return {};
  try {
    const res = await fetch(`https://api.resend.com/emails/inbound/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${env.mail.resendApiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const full = await res.json();
    return { text: first(full.text, full.text_body), html: first(full.html, full.html_body) };
  } catch (err) {
    logger.warn({ err: err.message }, "could not fetch inbound email body");
    return {};
  }
}

router.post(
  "/email",
  limiter,
  asyncHandler(async (req, res) => {
    // No secret configured means the endpoint is off - never open to anyone.
    if (!env.mail.inboundToken) {
      return res.status(503).json({ error: { message: "Inbound email is not configured" } });
    }
    if (!sameToken(req.query.token ?? "", env.mail.inboundToken)) {
      return res.status(401).json({ error: { message: "Unauthorized" } });
    }

    const payload = req.body || {};
    const data = payload.data || payload;

    const { name: fromName, email: fromEmail } = parseFrom(first(data.from, data.From));
    if (!fromEmail) return res.status(400).json({ error: { message: "The email has no sender" } });

    const toEmail = Array.isArray(data.to) ? data.to.join(", ") : first(data.to, data.To);
    const subject = first(data.subject, data.Subject) || "(no subject)";

    let textBody = first(data.text, data.text_body, data.textBody);
    let htmlBody = first(data.html, data.html_body, data.htmlBody);
    if (!textBody && !htmlBody) {
      const fetched = await fetchBody(data.email_id);
      textBody = fetched.text || "";
      htmlBody = fetched.html || "";
    }

    const headers = data.headers || data.Headers || {};
    const messageId = first(data.message_id, headerLookup(headers, "Message-Id"));
    const inReplyTo = first(data.in_reply_to, headerLookup(headers, "In-Reply-To"));

    // The provider may deliver the same email twice.
    if (messageId && (await SupportEmail.exists({ messageId, direction: "inbound" }))) {
      return res.json({ ok: true, deduped: true });
    }

    // A reply joins the thread of the message it answers; anything else starts one.
    const parent = inReplyTo ? await SupportEmail.findOne({ messageId: inReplyTo }).select("threadId").lean() : null;
    const threadId = parent?.threadId || inReplyTo || messageId || `thread_${Date.now()}`;

    const attachments = (Array.isArray(data.attachments) ? data.attachments : []).map((a) => ({
      filename: first(a.filename, a.name) || "attachment",
      url: first(a.url, a.path),
      contentType: first(a.content_type, a.contentType),
    }));

    await SupportEmail.create({
      fromEmail,
      fromName,
      toEmail,
      subject: subject.slice(0, 500),
      textBody,
      htmlBody: htmlBody ? emailHtml(htmlBody) : "",
      receivedAt: new Date(),
      messageId,
      inReplyTo,
      threadId,
      status: "unread",
      direction: "inbound",
      attachments,
    });

    res.json({ ok: true });
  }),
);

export default router;
