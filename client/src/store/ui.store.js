import { create } from "zustand";

const KEY = "avatar-app.sidebar-collapsed";

// Remembered per browser. Storage can be blocked, so both directions are
// best effort and the sidebar simply starts expanded.
function load() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useUi = create((set, get) => ({
  sidebarCollapsed: load(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Not persisted; still toggles for this session.
    }
    set({ sidebarCollapsed: next });
  },

  // The navigation drawer on phones and small tablets. Never persisted: a
  // drawer left open on reload would cover the page someone just asked for.
  navOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
}));
