import mongoose from "mongoose";

export const TEMPLATE_TYPES = [
  "none",
  "welcome_email",
  "invitation_email",
  "forgot_password",
  "plan_activated",
  "plan_updated",
  "plan_deactivated_refund",
  "subscription_cancelled",
  "training_webinar",
];

/**
 * A reusable email. `isSystemTemplate` marks the ones automation may use
 * (welcome, invitation, password reset...); the rest are for manual sends only.
 * Bodies carry {{placeholders}} filled in per recipient.
 */
const emailTemplateSchema = new mongoose.Schema(
  {
    templateType: { type: String, enum: TEMPLATE_TYPES, default: "none", index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    fromName: { type: String, trim: true, maxlength: 80 },
    htmlBody: { type: String, required: true },
    textBody: { type: String },
    isActive: { type: Boolean, default: true },
    isSystemTemplate: { type: Boolean, default: false },
    placeholdersGuide: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

export const EmailTemplate = mongoose.model("EmailTemplate", emailTemplateSchema);
