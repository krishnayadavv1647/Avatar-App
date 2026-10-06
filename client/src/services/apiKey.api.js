import { api } from "@/lib/apiClient";

/** Personal keys for the app's MCP endpoint. The key itself comes back once, from `create`. */
export const apiKeyApi = {
  list: () => api.get("/api-keys").then((r) => r.keys),
  create: (name) => api.post("/api-keys", { name }).then((r) => r.key),
  revoke: (id) => api.del(`/api-keys/${id}`),
};
