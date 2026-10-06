import mongoose from "mongoose";

/**
 * An email to send later to an audience resolved at send time. The scheduler
 * claims it by moving pending -> sending in one atomic update, so two server
 * instances can never send it twice.
 */
const scheduledEmailSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    htmlBody: { type: String, required: true },
    textBody: { type: String },
    fromName: { type: String, trim: true, maxlength: 80 },
    scheduledDate: { type: Date, required: true, index: true },
    // The same criteria the bulk composer uses; see modules/comms/audience.js.
    audience: { type: mongoose.Schema.Types.Mixed, default: () => ({ mode: "all" }) },
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    startedAt: Date,
    sentDate: Date,
    errorMessage: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const ScheduledEmail = mongoose.model("ScheduledEmail", scheduledEmailSchema);
