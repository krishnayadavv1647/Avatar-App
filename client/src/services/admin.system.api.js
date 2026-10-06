import { api } from "@/lib/apiClient";

const tz = () => encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);

/** Admin: analytics, credit usage, API keys, app config, error logs. Platform admins only. */
export const adminSystemApi = {
  analytics: () => api.get(`/admin/analytics?tz=${tz()}`),

  creditUsage: (days) => api.get(`/admin/credit-usage?days=${days}&tz=${tz()}`),
  /** `rules` is { providerId: dollarsPerMinute }; a provider left out falls back to its default. */
  saveCostRules: (rules) => api.put("/admin/credit-usage/rules", { rules }),

  apiConfigs: () => api.get("/admin/api-configs"),
  /** `apiKey` only when a new key was typed; `clearKey` removes the saved one. */
  updateApiConfig: (serviceName, patch) => api.put(`/admin/api-configs/${serviceName}`, patch).then((r) => r.config),
  testApiConfig: (serviceName) => api.post(`/admin/api-configs/${serviceName}/test`),
  testStorage: () => api.post("/admin/system/storage-test"),

  config: () => api.get("/admin/config"),
  saveConfig: (settings) => api.put("/admin/config", { settings }),
  uploadImage: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.upload("/admin/config/upload", form).then((r) => r.url);
  },

  errorLogs: ({ q = "", severity = "", status = "", sort = "timestamp", dir = "desc", page = 1, limit = 25 } = {}) =>
    api.get(
      `/admin/error-logs?${new URLSearchParams({
        ...(q && { q }),
        ...(severity && { severity }),
        ...(status && { status }),
        sort,
        dir,
        page: String(page),
        limit: String(limit),
      })}`,
    ),
  setErrorLogStatus: (id, status) => api.patch(`/admin/error-logs/${id}`, { status }),
  removeErrorLog: (id) => api.del(`/admin/error-logs/${id}`),
  clearResolvedErrorLogs: () => api.del("/admin/error-logs/resolved"),
};

/** The public subset of the app config. Needs no sign-in. */
export const siteConfigApi = {
  get: () => api.get("/config"),
};
