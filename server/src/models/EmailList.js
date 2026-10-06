import mongoose from "mongoose";

/** A named group of recipients to mail. Members live in EmailListMember; counts are computed, not stored. */
const emailListSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const EmailList = mongoose.model("EmailList", emailListSchema);
