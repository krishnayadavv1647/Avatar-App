import { api } from "@/lib/apiClient";

/** Personal keys for the app's MCP endpoint. The key itself comes back once, from `create`. */
export const apiKeyApi = {
  list: () => api.get("/api-keys").then((r) => r.keys),
  create: (name) => api.post("/api-keys", { name }).then((r) => r.key),
  revoke: (id) => api.del(`/api-keys/${id}`),
};

/** Apps connected through "Connect" in Claude, ChatGPT and similar. */
export const connectionApi = {
  list: () => api.get("/oauth/connections").then((r) => r.connections),
  disconnect: (id) => api.del(`/oauth/connections/${id}`),
  /** Who is asking, for the permission screen. `params` is the authorize query. */
  describe: (params) => api.get(`/oauth/authorize?${new URLSearchParams(params)}`),
  /** The answer; resolves to `{ redirectTo }`. */
  decide: (params, allow) => api.post("/oauth/authorize", { ...params, allow }),
};
