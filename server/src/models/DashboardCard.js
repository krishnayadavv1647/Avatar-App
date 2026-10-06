import mongoose from "mongoose";

/**
 * A feature card an admin configures for the dashboard. As in the product this
 * was modelled on, nothing shows these to end users yet - the admin screen
 * manages the records, and a dashboard section can read them later.
 */
const dashboardCardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    iconName: { type: String, default: "Sparkles" },
    accentColor: {
      type: String,
      enum: ["accent-blue", "accent-purple", "accent-green", "accent-orange"],
      default: "accent-blue",
    },
    targetPage: { type: String, required: true, trim: true },
    // Overrides targetPage when set.
    targetLink: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    requiredFeature: { type: String, trim: true },
    isLarge: { type: Boolean, default: false },
    // Features section instead of "Create your way".
    isFeatureSection: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const DashboardCard = mongoose.model("DashboardCard", dashboardCardSchema);
