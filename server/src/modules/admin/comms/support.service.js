import { env } from "../../../config/env.js";
import { SupportEmail } from "../../../models/index.js";
import { NOT_CONFIGURED, mailReady, send } from "../../comms/sender.js";
import { brand } from "../../comms/template.js";

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** What an admin typed, as an email body: escaped, with line breaks kept. */
const textToHtml = (text) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#333;">${escapeHtml(text).replace(/\n/g, "<br/>")}</div>`;

const requireMail = () => {
  if (!mailReady()) throw fail(NOT_CONFIGURED, 503);
};

/** The address replies come from: the configured sender, else the support address, else the admin who wrote it. */
const supportFrom = (appBrand, admin) => env.mail.fromEmail || appBrand.supportEmail || admin.email;

export const support = {
  /** The newest 200 messages; the inbox filters and threads them on the client. */
  list: () => SupportEmail.find().sort({ receivedAt: -1 }).limit(200).lean(),

  async setStatus(id, status) {
    const doc = await SupportEmail.findByIdAndUpdate(id, { status }, { new: true }).lean();
    if (!doc) throw fail("Email not found", 404);
    return doc;
  },

  async remove(id) {
    if (!(await SupportEmail.findByIdAndDelete(id))) throw fail("Email not found", 404);
  },

  /** Replies to an inbound email: "Re:" subject, same thread, original marked replied, copy kept. */
  async reply(id, text, admin) {
    requireMail();
    const original = await SupportEmail.findById(id);
    if (!original) throw fail("Email not found", 404);

    const appBrand = await brand();
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    const html = textToHtml(text);
    const res = await send({ to: original.fromEmail, subject, html, text, fromName: `${appBrand.name} Support` });
    if (!res.ok) throw fail(res.error || "Reply failed", 502);

    // Give a message that arrived without a thread one, so the reply and the original group together.
    const threadId = original.threadId || original.messageId || `thread_${original._id}`;
    const outbound = await SupportEmail.create({
      fromEmail: supportFrom(appBrand, admin),
      fromName: `${appBrand.name} Support`,
      toEmail: original.fromEmail,
      subject,
      textBody: text,
      htmlBody: html,
      messageId: res.id,
      inReplyTo: original.messageId || "",
      threadId,
      status: "read",
      direction: "outbound",
      repliedBy: admin.email,
    });
    await SupportEmail.updateOne({ _id: original._id }, { status: "replied", threadId });
    return outbound.toObject();
  },

  /** A new outbound email, kept in the mailbox as its own thread. */
  async compose({ to, subject, body }, admin) {
    requireMail();
    const appBrand = await brand();
    const html = textToHtml(body);
    const res = await send({ to, subject, html, text: body, fromName: `${appBrand.name} Support` });
    if (!res.ok) throw fail(res.error || "Send failed", 502);

    const outbound = await SupportEmail.create({
      fromEmail: supportFrom(appBrand, admin),
      fromName: `${appBrand.name} Support`,
      toEmail: to,
      subject,
      textBody: body,
      htmlBody: html,
      messageId: res.id,
      threadId: res.id || `thread_${Date.now()}`,
      status: "replied",
      direction: "outbound",
      repliedBy: admin.email,
    });
    return outbound.toObject();
  },
};
