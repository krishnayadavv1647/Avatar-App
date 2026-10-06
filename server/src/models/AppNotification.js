import mongoose from "mongoose";

/**
 * An in-app announcement an admin writes. Shown to a signed-in user once it is
 * published, its publish date has passed and their role is targeted (see
 * modules/siteContent). `message` is HTML, sanitised before it is stored.
 */
const appNotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    // A real date-time, so an edit puts back exactly what was saved.
    publishDate: { type: Date, index: true },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    // bell_only: only in the notification list. popup_and_bell: a dialog once, then the list.
    displayType: { type: String, enum: ["bell_only", "popup_and_bell"], default: "bell_only" },
    // "admin" = a platform admin, "user" = everyone else.
    targetRoles: { type: [{ type: String, enum: ["user", "admin"] }], default: ["user", "admin"] },
    icon: { type: String, default: "Bell" },
    linkUrl: { type: String, trim: true },
    linkText: { type: String, trim: true },
  },
  { timestamps: true },
);

export const AppNotification = mongoose.model("AppNotification", appNotificationSchema);
