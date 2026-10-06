import { api } from "@/lib/apiClient";

/** The admin Credits tab's calls. Platform admins only. */
export const creditsAdminApi = {
  /** `{ rates, defaults, welcomeCredits, models }` */
  settings: () => api.get("/admin/credits/settings"),
  saveSettings: (body) => api.put("/admin/credits/settings", body),

  packs: () => api.get("/admin/credit-packs").then((r) => r.packs),
  createPack: (pack) => api.post("/admin/credit-packs", pack).then((r) => r.pack),
  updatePack: (id, patch) => api.patch(`/admin/credit-packs/${id}`, patch).then((r) => r.pack),
  removePack: (id) => api.del(`/admin/credit-packs/${id}`),

  /** The platform's ledger: `{ transactions, total, page, pages }`. */
  transactions: ({ kind = "", q = "", page = 1 } = {}) =>
    api.get(`/admin/credit-transactions?${new URLSearchParams({ ...(kind && { kind }), ...(q && { q }), page: String(page) })}`),

  /** Whether Stripe's keys are set, from the same list the API Keys tab shows. */
  apiConfigs: () => api.get("/admin/api-configs").then((r) => r.configs),
};
