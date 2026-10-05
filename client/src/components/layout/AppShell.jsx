import clsx from "clsx";
import Sidebar from "./Sidebar";
import { useUi } from "@/store/ui.store";

/**
 * Sidebar plus a scrolling content column.
 *
 * Signed-out routes render outside this, which is why it lives around the
 * authenticated routes rather than around the whole router.
 *
 * `wide` drops the reading-width container for pages built edge to edge, like
 * the dashboard's full-width hero. Everything else keeps the container.
 *
 * Below the lg breakpoint the sidebar becomes a drawer, so the page gets the
 * full width and a slim top bar carries the button that opens it.
 */
export default function AppShell({ children, wide = false }) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const setNavOpen = useUi((s) => s.setNavOpen);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar />
      <div
        className={clsx(
          "min-w-0 transition-[padding] duration-200 ease-ease",
          collapsed ? "lg:pl-[var(--sidebar-w-collapsed)]" : "lg:pl-sidebar",
        )}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-[rgba(10,10,10,0.9)] px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="flex h-10 w-10 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
          <span className="flex items-center gap-2">
            <img src="/logo.png" alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />
            <span className="text-ui font-semibold">Avatar Studio</span>
          </span>
        </header>

        <main
          className={
            wide
              ? "px-3 pb-12 pt-3 sm:px-5 sm:pt-4"
              : "mx-auto max-w-container px-4 py-6 sm:px-8 sm:py-9 lg:px-gutter"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
