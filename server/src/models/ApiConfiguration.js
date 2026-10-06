import mongoose from "mongoose";

/**
 * One vendor's credentials as an admin set them in the panel.
 *
 * `apiKey` is sealed with utils/secretBox.js and never leaves the server: the
 * API only ever reports whether a key exists and its last four characters.
 * What the app actually uses at runtime is decided by applyApiConfigs() in
 * modules/admin/system/apiConfig.service.js, which copies an active, saved key
 * over the matching env field - and puts the environment value back when the
 * config is switched off or the key removed.
 */
const apiConfigurationSchema = new mongoose.Schema(
  {
    serviceName: { type: String, required: true, unique: true, trim: true },
    displayName: String,
    description: String,
    apiKey: { type: String, default: "" },
    // Used by Test Connection. The app itself talks to each vendor's standard endpoint.
    baseUrl: String,
    documentation: String,
    isActive: { type: Boolean, default: true },
    settings: {
      // Seconds Test Connection waits for the vendor.
      timeout: { type: Number, default: 30 },
    },
    usageStats: {
      totalRequests: { type: Number, default: 0 },
      successfulRequests: { type: Number, default: 0 },
      failedRequests: { type: Number, default: 0 },
      lastUsed: Date,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const ApiConfiguration = mongoose.model("ApiConfiguration", apiConfigurationSchema);
