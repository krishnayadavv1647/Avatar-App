import { AppNotification, HeroBanner, User, UserNotificationState } from "../../models/index.js";
import { isPlatformAdmin } from "../../middleware/admin.js";

/**
 * What a signed-in person sees of what the admins published.
 *
 * A notification reaches someone when it is published, its publish date has
 * passed, and their role is targeted - "admin" for a platform admin, "user" for
 * everyone else. It is "new" when published after they last looked
 * (lastCheckAt); a person who has never looked sees everything as new.
 */

const roleOf = async (userId) => {
  const user = await User.findById(userId).select("email").lean();
  return isPlatformAdmin(user?.email) ? "admin" : "user";
};

async function lastCheckAt(userId) {
  const state = await UserNotificationState.findOne({ userId }).lean();
  return state?.lastCheckAt ?? null;
}

/** Newest first. `publishDate` falls back to when the record was created. */
async function visible(userId, now = new Date()) {
  const role = await roleOf(userId);
  const rows = await AppNotification.find({ status: "published", targetRoles: role }).lean();
  return rows
    .map((n) => ({ ...n, effectiveDate: n.publishDate || n.createdAt }))
    .filter((n) => n.effectiveDate <= now)
    .sort((a, b) => b.effectiveDate - a.effectiveDate);
}

const isNew = (n, since) => !since || n.effectiveDate > since;

export const siteContent = {
  /** The notification list, each flagged new against the last visit as it was *before* this one. */
  async notifications(userId) {
    const [rows, since] = await Promise.all([visible(userId), lastCheckAt(userId)]);
    return {
      lastCheckAt: since,
      notifications: rows.map((n) => ({ ...n, isNew: isNew(n, since) })),
    };
  },

  /** The sidebar badge count, and the popup to show once if there is one. */
  async summary(userId) {
    const [rows, since] = await Promise.all([visible(userId), lastCheckAt(userId)]);
    const fresh = rows.filter((n) => isNew(n, since));
    const popup = fresh.find((n) => n.displayType === "popup_and_bell") || null;
    return { unreadCount: fresh.length, popup };
  },

  /** Marks everything up to now as seen. Closing the popup and opening the list both do this. */
  async markSeen(userId) {
    const now = new Date();
    await UserNotificationState.updateOne({ userId }, { lastCheckAt: now }, { upsert: true });
    return { lastCheckAt: now };
  },

  /** Active banners in display order, for the dashboard cover. */
  banners: () => HeroBanner.find({ isActive: true }).sort({ displayOrder: 1, createdAt: 1 }).limit(20).lean(),
};
