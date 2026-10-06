import mongoose from "mongoose";

/**
 * Something that went wrong on the server, kept for the admin's Error Logs
 * tab. Written through utils/errorLog.js, which never throws.
 */
const errorLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    userEmail: String,
    errorType: { type: String, required: true },
    functionName: String,
    message: { type: String, required: true },
    // Stack, payload, vendor response - anything useful for debugging.
    details: mongoose.Schema.Types.Mixed,
    severity: { type: String, enum: ["INFO", "WARNING", "ERROR", "CRITICAL"], default: "ERROR" },
    status: { type: String, enum: ["NEW", "ACKNOWLEDGED", "RESOLVED"], default: "NEW" },
    relatedEntityType: String,
    relatedEntityId: String,
  },
  { timestamps: true },
);

export const ErrorLog = mongoose.model("ErrorLog", errorLogSchema);
