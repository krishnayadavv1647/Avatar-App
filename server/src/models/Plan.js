import mongoose from "mongoose";

/**
 * A plan an admin creates and assigns to users.
 *
 * The limits are read live at the moment they matter (starting a call,
 * creating an avatar), so editing a plan changes it for everyone on it - no
 * re-assigning. Zero means "no limit" for minutes and avatars.
 *
 * The price is what the plan is sold for; nothing charges it yet.
 */
const planSchema = new mongoose.Schema(
  {
    // Stable id shown on subscriptions and in reports; fixed once created.
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    priceCents: { type: Number, min: 0, default: 0 },

    includedMinutes: { type: Number, min: 0, default: 0 },
    // Past the included minutes, keep going (and bill) rather than refuse calls.
    overageEnabled: { type: Boolean, default: false },
    concurrencyLimit: { type: Number, min: 1, default: 3 },
    maxAvatars: { type: Number, min: 0, default: 0 },

    // New sign-ups start on the default plan. At most one is default.
    isDefault: { type: Boolean, default: false },
    // Archived plans stay on the users who have them but cannot be assigned.
    active: { type: Boolean, default: true },

    // Presentation, as the admin's plan cards show it.
    displayOrder: { type: Number, min: 0, default: 0 },
    // Whether regular users may see the plan; admins always do. Nothing
    // user-facing lists plans yet, so today it only labels the card.
    visible: { type: Boolean, default: true },
    // How the plan is sold. A label for now: the minutes still renew monthly.
    durationType: { type: String, enum: ["monthly", "lifetime"], default: "monthly" },
    conditionBoxDescription: { type: String, trim: true },
    purchaseUrl: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const Plan = mongoose.model("Plan", planSchema);
