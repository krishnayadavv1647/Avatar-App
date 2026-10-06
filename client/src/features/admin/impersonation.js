import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminUsersApi } from "@/services/admin.users.api";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/store/auth.store";

/**
 * "Act as user", from the admin's side.
 *
 * Starting swaps this tab to the user's identity (store/auth.store.js keeps the
 * admin's own session parked); leaving swaps it back. Both end in a full page
 * load, so nothing from one identity is left on screen under the other.
 */

/** Leaves the user's account and returns to the admin's own. */
export async function exitImpersonation() {
  // Recorded in the user's audit log; the swap back must not depend on it.
  await api.post("/impersonation/end").catch(() => {});
  useAuth.getState().stopImpersonation();
  window.location.assign("/admin?tab=users");
}

/**
 * `ask(user)` opens the confirmation; `start` does it. Render `dialogProps`
 * into a ConfirmDialog (see ActAsUserDialog) wherever the buttons live.
 */
export function useActAsUser() {
  const [target, setTarget] = useState(null);

  const start = useMutation({
    mutationFn: (id) => adminUsersApi.impersonate(id),
    onSuccess: (data) => {
      useAuth.getState().startImpersonation(data);
      window.location.assign("/");
    },
  });

  return {
    ask: setTarget,
    target,
    close: () => {
      setTarget(null);
      start.reset();
    },
    start,
  };
}
