import { create } from "zustand";
import { queryClient } from "@/lib/queryClient";

const KEY = "avatar-app.auth";

/**
 * Auth state, mirrored into localStorage so a reload does not sign the user out.
 *
 * Only the tokens and a display copy of the user live here. Anything
 * authoritative is re-read from the server, because localStorage is editable by
 * the person sitting in front of it.
 */
function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

function save(state) {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode, blocked storage - the session still works for this tab.
  }
}

const initial = load();

export const useAuth = create((set) => ({
  user: initial?.user || null,
  accessToken: initial?.accessToken || null,
  refreshToken: initial?.refreshToken || null,
  // Set while an admin is acting as a user: their own session, parked here,
  // and who they are acting as. See features/admin/impersonation.js.
  impersonating: initial?.impersonating || null,

  signedIn: () => Boolean(useAuth.getState().accessToken),

  setSession: ({ user, accessToken, refreshToken }) => {
    // Cached queries are not keyed by account, so a new session starts empty
    // rather than showing whoever was signed in on this tab before.
    queryClient.clear();
    const next = { user, accessToken, refreshToken, impersonating: null };
    save(next);
    set(next);
  },

  /**
   * Switches this tab to another user's identity, keeping the admin's own
   * session to return to. The token has no refresh token: it simply ends.
   */
  startImpersonation: ({ accessToken, user, expiresAt }) => {
    const s = useAuth.getState();
    if (s.impersonating) return;
    queryClient.clear();
    const next = {
      user,
      accessToken,
      refreshToken: null,
      impersonating: {
        admin: { user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken },
        as: { id: user.id, email: user.email, name: user.name },
        expiresAt,
      },
    };
    save(next);
    set(next);
  },

  /** Back to the admin's own session. */
  stopImpersonation: () => {
    const { impersonating } = useAuth.getState();
    if (!impersonating) return;
    queryClient.clear();
    const next = { ...impersonating.admin, impersonating: null };
    save(next);
    set(next);
  },

  /** Replaces only the tokens, after a refresh. */
  setTokens: ({ accessToken, refreshToken }) =>
    set((s) => {
      const next = { ...s, accessToken, refreshToken };
      save({ user: next.user, accessToken, refreshToken, impersonating: s.impersonating });
      return { accessToken, refreshToken };
    }),

  clear: () => {
    queryClient.clear();
    save(null);
    set({ user: null, accessToken: null, refreshToken: null, impersonating: null });
  },
}));
