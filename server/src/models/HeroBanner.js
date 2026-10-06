import mongoose from "mongoose";

/**
 * A slide on the dashboard's cover. Active banners rotate in `displayOrder`
 * (lowest first); with none active the dashboard keeps its built-in hero.
 */
const heroBannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // The cover's two stacked title lines: the first bold, the second light.
    titleLine1: { type: String, trim: true, maxlength: 60 },
    titleLine2: { type: String, trim: true, maxlength: 60 },
    subtitle: { type: String, required: true, trim: true, maxlength: 500 },
    imageUrl: { type: String, trim: true },
    backgroundImageUrl: { type: String, trim: true },
    // Plays muted and looping behind the cover instead of the picture.
    backgroundVideoUrl: { type: String, trim: true },
    ctaText: { type: String, trim: true, default: "Try Now" },
    ctaLink: { type: String, trim: true },
    walkthroughVideoUrl: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const HeroBanner = mongoose.model("HeroBanner", heroBannerSchema);
