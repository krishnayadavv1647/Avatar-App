import { api } from "@/lib/apiClient";

/** The people in the signed-in person's workspace. Owners and admins only. */
export const teamApi = {
  /** `{ members: [{ id, name, email, role, title, photoUrl, lastLoginAt, createdAt }], me, role }`. */
  list: () => api.get("/team/members"),
  /** A real account that can sign in straight away. `role` is "admin" or "member". */
  create: (input) => api.post("/team/members", input),
  update: (id, patch) => api.patch(`/team/members/${id}`, patch),
  resetPassword: (id, password) => api.post(`/team/members/${id}/password`, { password }),
  remove: (id) => api.del(`/team/members/${id}`),
};
