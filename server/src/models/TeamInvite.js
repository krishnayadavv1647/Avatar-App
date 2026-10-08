import mongoose from "mongoose";

/**
 * A link that lets someone join a workspace: an owner or admin makes it, shares
 * it, and whoever opens it creates their own account inside that workspace with
 * the role set here.
 *
 * Only a hash of the token is stored, so a leaked database cannot be turned into
 * working links; the link itself is shown once, when it is made. A link can be
 * used a set number of times and stops working at its expiry or when revoked.
 * With an `email` it works for that address only.
 */
const teamInviteSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    email: { type: String, lowercase: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    maxUses: { type: Number, default: 1, min: 1 },
    uses: { type: Number, default: 0, min: 0 },
    usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: ["active", "revoked"], default: "active", index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const TeamInvite = mongoose.model("TeamInvite", teamInviteSchema);
