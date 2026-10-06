import { api } from "@/lib/apiClient";

/**
 * Platform-admin calls for the Comms and UI tabs: notifications, hero banners,
 * dashboard cards, mailing, support mailbox. Kept apart from admin.api.js,
 * which belongs to the Users and Plans screens.
 */
const BASE = "/admin";

export const commsApi = {
  /* ------------------------------------ content ------------------------------------ */
  notifications: () => api.get(`${BASE}/notifications`).then((r) => r.notifications),
  createNotification: (body) => api.post(`${BASE}/notifications`, body).then((r) => r.notification),
  updateNotification: (id, body) => api.patch(`${BASE}/notifications/${id}`, body).then((r) => r.notification),
  deleteNotification: (id) => api.del(`${BASE}/notifications/${id}`),

  banners: () => api.get(`${BASE}/hero-banners`).then((r) => r.banners),
  createBanner: (body) => api.post(`${BASE}/hero-banners`, body).then((r) => r.banner),
  updateBanner: (id, body) => api.patch(`${BASE}/hero-banners/${id}`, body).then((r) => r.banner),
  deleteBanner: (id) => api.del(`${BASE}/hero-banners/${id}`),

  cards: () => api.get(`${BASE}/dashboard-cards`).then((r) => r.cards),
  createCard: (body) => api.post(`${BASE}/dashboard-cards`, body).then((r) => r.card),
  updateCard: (id, body) => api.patch(`${BASE}/dashboard-cards/${id}`, body).then((r) => r.card),
  deleteCard: (id) => api.del(`${BASE}/dashboard-cards/${id}`),

  /** An image or video for a banner or card. Resolves to { url, kind }. */
  upload: (file, folder) => {
    const form = new FormData();
    form.append("folder", folder);
    form.append("file", file);
    return api.upload(`${BASE}/uploads`, form);
  },

  /* ------------------------------------ mailing ------------------------------------ */
  mailStats: () => api.get(`${BASE}/mailing/stats`),

  templates: () => api.get(`${BASE}/mailing/templates`).then((r) => r.templates),
  createTemplate: (body) => api.post(`${BASE}/mailing/templates`, body).then((r) => r.template),
  updateTemplate: (id, body) => api.patch(`${BASE}/mailing/templates/${id}`, body).then((r) => r.template),
  testTemplate: (id, to) => api.post(`${BASE}/mailing/templates/${id}/test`, { to }),

  lists: () => api.get(`${BASE}/mailing/lists`).then((r) => r.lists),
  createList: (body) => api.post(`${BASE}/mailing/lists`, body).then((r) => r.list),
  updateList: (id, body) => api.patch(`${BASE}/mailing/lists/${id}`, body).then((r) => r.list),
  deleteList: (id) => api.del(`${BASE}/mailing/lists/${id}`),
  members: (id) => api.get(`${BASE}/mailing/lists/${id}/members`).then((r) => r.members),
  addMember: (id, body) => api.post(`${BASE}/mailing/lists/${id}/members`, body).then((r) => r.member),
  removeMember: (id, memberId) => api.del(`${BASE}/mailing/lists/${id}/members/${memberId}`),
  /** { filename, csv } - the caller turns it into a download. */
  exportList: (id) => api.get(`${BASE}/mailing/lists/${id}/export`),

  audienceUsers: (q = "") => api.get(`${BASE}/mailing/users?${new URLSearchParams(q ? { q } : {})}`).then((r) => r.users),
  audienceCount: (audience) => api.post(`${BASE}/mailing/audience`, { audience }).then((r) => r.count),
  sendBulk: (body) => api.post(`${BASE}/mailing/bulk`, body),
  sendTest: (body) => api.post(`${BASE}/mailing/test`, body),

  scheduled: () => api.get(`${BASE}/mailing/scheduled`).then((r) => r.emails),
  schedule: (body) => api.post(`${BASE}/mailing/scheduled`, body).then((r) => r.email),
  cancelScheduled: (id) => api.post(`${BASE}/mailing/scheduled/${id}/cancel`),
  deleteScheduled: (id) => api.del(`${BASE}/mailing/scheduled/${id}`),
  runScheduled: () => api.post(`${BASE}/mailing/scheduled/run`),

  /* --------------------------------- support mailbox --------------------------------- */
  supportEmails: () => api.get(`${BASE}/support/emails`).then((r) => r.emails),
  setSupportStatus: (id, status) => api.patch(`${BASE}/support/emails/${id}`, { status }).then((r) => r.email),
  deleteSupportEmail: (id) => api.del(`${BASE}/support/emails/${id}`),
  replySupport: (id, text) => api.post(`${BASE}/support/emails/${id}/reply`, { text }).then((r) => r.email),
  composeSupport: (body) => api.post(`${BASE}/support/emails`, body).then((r) => r.email),
};
