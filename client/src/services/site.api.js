import { api } from "@/lib/apiClient";

/** What admins published for signed-in users: notifications and the dashboard's hero banners. */
export const siteApi = {
  /** { lastCheckAt, notifications[] } - each notification carries `isNew` against the previous visit. */
  notifications: () => api.get("/site/notifications"),
  /** { unreadCount, popup } - the sidebar badge and the one-time popup, if any. */
  summary: () => api.get("/site/notifications/summary"),
  /** Marks everything up to now as seen. */
  markSeen: () => api.post("/site/notifications/seen"),
  banners: () => api.get("/site/hero-banners").then((r) => r.banners),
};
