import { api } from "@/lib/apiClient";

/** What callers left with the workspace's avatars: leads, and requests for a person. */
export const leadsApi = {
  list: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return api.get(`/leads${query ? `?${query}` : ""}`).then((r) => r.leads);
  },
  setStatus: (id, status) => api.patch(`/leads/${id}`, { status }).then((r) => r.lead),
  handoffs: () => api.get("/leads/handoffs").then((r) => r.handoffs),
  setHandoffStatus: (id, status) => api.patch(`/leads/handoffs/${id}`, { status }).then((r) => r.handoff),
  /** The CSV as a Blob; the page turns it into a download. */
  exportCsv: () => api.blob("/leads/export.csv"),
};
