import { api } from "@/lib/apiClient";

/** Every avatar across all users, read-only. */
export const adminAvatarsApi = {
  list: ({ q = "", status = "", provider = "", page = 1 } = {}) =>
    api.get(
      `/admin/avatars?${new URLSearchParams({
        ...(q && { q }),
        ...(status && { status }),
        ...(provider && { provider }),
        page: String(page),
      })}`,
    ),
};
