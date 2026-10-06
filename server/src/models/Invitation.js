import mongoose from "mongoose";

/**
 * An admin's invitation for someone to join on a given plan. Only a hash of
 * the token is stored; the link is shown once, when the invitation is made.
 */
const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan" },
    message: { type: String, trim: true },
    status: { type: String, enum: ["pending", "accepted", "expired"], default: "pending", index: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Invitation = mongoose.model("Invitation", invitationSchema);
