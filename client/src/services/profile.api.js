import { api } from "@/lib/apiClient";

/** The signed-in person's own profile. Every call resolves to `{ profile }` except the password. */
export const profileApi = {
  get: () => api.get("/profile"),
  /** Any of `name`, `title`, `phone`, `timezone`, and `workspaceName` (owner only). */
  update: (patch) => api.patch("/profile", patch),
  setPhoto: (file) => {
    const form = new FormData();
    form.append("photo", file);
    return api.uploadPut("/profile/photo", form);
  },
  removePhoto: () => api.del("/profile/photo"),
  /** Resolves to `{ ok, user, accessToken, refreshToken }`: the fresh tokens keep this device signed in. */
  changePassword: (input) => api.post("/profile/password", input),
};
