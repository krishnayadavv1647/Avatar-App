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

  /** Links that still work: `{ invites: [{ id, role, email, uses, maxUses, expiresAt, createdBy }] }`. Never the token. */
  invites: () => api.get("/team/invites"),
  /** `{ role, expiresInDays: 1|7|30, maxUses: 1..50, email? }` -> `{ invite, link }`. The link is only ever in this answer. */
  createInvite: (input) => api.post("/team/invites", input),
  revokeInvite: (id) => api.del(`/team/invites/${id}`),
};

/** The page behind an invite link, before the person has an account. */
export const joinApi = {
  /** `{ workspace, role, invitedBy, email, expiresAt }`; rejects with a readable message when the link is no good. */
  describe: (token) => api.get(`/join/${token}`),
  /** Makes the account inside the workspace; resolves to a session (`{ user, accessToken, refreshToken }`). */
  join: (token, input) => api.post(`/join/${token}`, input),
};
