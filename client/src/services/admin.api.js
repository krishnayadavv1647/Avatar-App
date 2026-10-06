import { api } from "@/lib/apiClient";

/** Platform admin. Every route but `access` answers 403 unless the caller is in ADMIN_EMAILS. */
export const adminApi = {
  access: () => api.get("/admin/access").then((r) => r.admin),
  /** Total users, active users, open invitations, minutes used. */
  stats: () => api.get("/admin/stats"),
  overview: () =>
    api.get(`/admin/overview?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`),
  users: ({ q = "", page = 1 } = {}) =>
    api.get(`/admin/users?${new URLSearchParams({ ...(q && { q }), page: String(page) })}`),
  user: (id) => api.get(`/admin/users/${id}`),

  block: (id, reason) => api.post(`/admin/users/${id}/block`, { ...(reason && { reason }) }),
  unblock: (id) => api.del(`/admin/users/${id}/block`),
  assignPlan: (id, planId) => api.put(`/admin/users/${id}/plan`, { planId }),

  plans: () => api.get("/admin/plans").then((r) => r.plans),
  createPlan: (plan) => api.post("/admin/plans", plan).then((r) => r.plan),
  /** Adds the ready-made Free / Starter / Pro / Business plans that are not there yet. */
  addPlanTemplates: () => api.post("/admin/plans/templates"),
  updatePlan: (id, patch) => api.patch(`/admin/plans/${id}`, patch).then((r) => r.plan),
  removePlan: (id) => api.del(`/admin/plans/${id}`),
};
