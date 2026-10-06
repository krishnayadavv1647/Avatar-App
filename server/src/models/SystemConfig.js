import mongoose from "mongoose";

/**
 * Key/value settings an admin edits from the panel (app name, logo, support
 * email, cost rules, ...). Values are strings; structured ones are stored as
 * JSON text. The set of known keys and their defaults lives in
 * modules/admin/system/config.catalog.js, not here.
 */
const systemConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: String, default: "" },
    description: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const SystemConfig = mongoose.model("SystemConfig", systemConfigSchema);
