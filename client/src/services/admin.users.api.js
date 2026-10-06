import { api, apiUrl } from "@/lib/apiClient";
import { useAuth } from "@/store/auth.store";

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== "all") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

/**
 * The admin Users, Invite and Plans tabs' calls. Platform admins only.
 *
 * Filters are `{ q, status, plan, source, page }`; "all" or empty means no
 * filter, and is simply left out of the request.
 */
export const adminUsersApi = {
  /** `{ users, total, activeTotal, page, pageSize }` */
  list: (filters = {}) => api.get(`/admin/users${query(filters)}`),
  create: (fields) => api.post("/admin/users", fields),
  /** `{ user, planEmail: "sent" | "failed" | "skipped" }` */
  update: (id, fields) => api.patch(`/admin/users/${id}`, fields),
  remove: (id) => api.del(`/admin/users/${id}`),

  /**
   * The filtered users as a CSV, every page. Fetched with the sign-in token
   * (a plain link would not carry it) and handed to the browser as a download.
   */
  async exportCsv(filters = {}) {
    const url = apiUrl(`/admin/users/export.csv${query({ ...filters, page: undefined })}`);
    const get = () => fetch(url, { headers: { authorization: `Bearer ${useAuth.getState().accessToken}` } });

    let res = await get();
    if (res.status === 401) {
      // The access token expired; any API call refreshes it, then try again.
      await api.get("/auth/me").catch(() => {});
      res = await get();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || `Export failed (${res.status})`);
    }

    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "users_export.csv";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  },

  /** `{ invitation, link, emailSent, emailError }` - the link is only ever returned here. */
  createInvitation: (fields) => api.post("/admin/invitations", fields),
  invitations: () => api.get("/admin/invitations").then((r) => r.invitations),
  revokeInvitation: (id) => api.del(`/admin/invitations/${id}`),

  /** Uploads a plan thumbnail and returns its URL; the plan is saved with it. */
  uploadPlanThumbnail: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.upload("/admin/plans/thumbnail", form).then((r) => r.thumbnailUrl);
  },
};

/** The public invitation link: what it offers, and accepting it. */
export const invitationApi = {
  describe: (token) => api.get(`/invitations/${encodeURIComponent(token)}`).then((r) => r.invitation),
  accept: (token) => api.post(`/invitations/${encodeURIComponent(token)}/accept`),
};
