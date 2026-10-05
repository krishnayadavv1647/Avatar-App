import { api } from "@/lib/apiClient";

export const authApi = {
  register: (input) => api.post("/auth/register", input),
  login: (input) => api.post("/auth/login", input),
  /** Signs in (or up) with the ID token from Google's button. */
  google: (credential) => api.post("/auth/google", { credential }),
  /** `{ googleClientId }` - null when Google sign-in is not set up. */
  config: () => api.get("/auth/config"),
  logout: () => api.post("/auth/logout"),
  me: () => api.get("/auth/me"),
};
