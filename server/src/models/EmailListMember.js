import mongoose from "mongoose";

const emailListMemberSchema = new mongoose.Schema(
  {
    listId: { type: mongoose.Schema.Types.ObjectId, ref: "EmailList", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    // Set when the address belongs to a registered user.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fullName: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: ["active", "unsubscribed", "bounced"], default: "active" },
    source: { type: String, default: "manual" },
  },
  { timestamps: true },
);

// One row per address per list; the add endpoint relies on this for its duplicate check.
emailListMemberSchema.index({ listId: 1, email: 1 }, { unique: true });
emailListMemberSchema.index({ email: 1, status: 1 });

export const EmailListMember = mongoose.model("EmailListMember", emailListMemberSchema);
