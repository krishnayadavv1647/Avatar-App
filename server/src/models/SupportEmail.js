import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  { filename: String, url: String, contentType: String },
  { _id: false },
);

/** One message in the support mailbox: received through the inbound webhook, or sent by an admin. */
const supportEmailSchema = new mongoose.Schema(
  {
    fromEmail: { type: String, required: true, trim: true },
    fromName: { type: String, trim: true },
    toEmail: { type: String, trim: true },
    subject: { type: String, required: true, trim: true },
    textBody: String,
    // Sanitised before it is stored; the client sanitises again when it renders.
    htmlBody: String,
    receivedAt: { type: Date, default: Date.now, index: true },
    // Message-ID header: dedupes a webhook the provider delivers twice.
    messageId: { type: String, index: true },
    inReplyTo: String,
    threadId: { type: String, index: true },
    status: { type: String, enum: ["unread", "read", "replied", "archived"], default: "unread" },
    direction: { type: String, enum: ["inbound", "outbound"], default: "inbound" },
    repliedBy: String,
    attachments: [attachmentSchema],
  },
  { timestamps: true },
);

export const SupportEmail = mongoose.model("SupportEmail", supportEmailSchema);
