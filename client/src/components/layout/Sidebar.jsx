import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "@/services/auth.api";
import { useAuth } from "@/store/auth.store";
import { useUi } from "@/store/ui.store";
import { useIsAdmin } from "@/features/admin/useIsAdmin";
import { useBranding } from "@/hooks/useBranding";
import NotificationPopup from "@/features/site/NotificationPopup";
import { useNotificationSummary } from "@/features/site/useNotificationSummary";

/**
 * Left navigation, grouped by what you are doing.
 *
 * Laid out like a creative-tool dashboard: small uppercase section labels, a
 * collapse toggle beside the logo, and the account pinned to the bottom as a
 * card that opens its own menu. The look stays LemonSlice's - dark, rounded,
 * a translucent active state.
 *
 * Sections are data so adding a page is one line, and so the section a page
 * belongs to is stated rather than implied by where it happens to sit.
 * Only pages that exist are listed.
 */
const SECTIONS = [
  {
    title: "Explore",
    items: [{ to: "/", label: "Home", icon: HomeIcon, end: true }],
  },
  {
    title: "Assets",
    items: [
      { to: "/avatars", label: "Avatars", icon: AvatarIcon },
    ],
  },
  {
    title: "My work",
    items: [
      { to: "/conversations", label: "Conversations", icon: ChatIcon },
      { to: "/analytics", label: "Usage", icon: ChartIcon },
      { to: "/connect", label: "AI tools", icon: PlugIcon },
      { to: "/notifications", label: "Notifications", icon: BellIcon, badge: true },
    ],
  },
];

// Shown only to platform admins (ADMIN_EMAILS on the server).
const ADMIN_SECTION = {
  title: "Admin",
  items: [
    { to: "/admin", label: "Admin panel", icon: ShieldIcon },
  ],
};

const itemClass = (collapsed) =>
  clsx(
    "mb-0.5 flex w-full items-center gap-3 rounded py-2 text-ui transition-colors",
    collapsed ? "justify-center px-0" : "px-3",
  );

const DESKTOP = "(min-width: 1024px)";

/**
 * Whether the lg breakpoint applies. Below it the sidebar is a drawer opened
 * from the top bar (see AppShell), because a fixed 232px column leaves a phone
 * almost no room for the page. Re-checked on resize as well as on the media
 * query, since a page loaded in a hidden frame may never get the change event.
 */
function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(DESKTOP).matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP);
    if (!query) return undefined;
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return desktop;
}

export default function Sidebar() {
  const desktop = useIsDesktop();
  // Collapsing to icons is a desktop preference; the drawer always has labels.
  const collapsed = useUi((s) => s.sidebarCollapsed) && desktop;
  const { isAdmin } = useIsAdmin();
  const unreadNotifications = useNotificationSummary().data?.unreadCount || 0;
  const brand = useBranding();
  const sections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
  const toggle = useUi((s) => s.toggleSidebar);
  const navOpen = useUi((s) => s.navOpen);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const { pathname } = useLocation();

  // Following a link closes the drawer, as does growing past the breakpoint.
  useEffect(() => setNavOpen(false), [pathname, desktop, setNavOpen]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen, setNavOpen]);

  const drawer = !desktop;
  const hidden = drawer && !navOpen;

  return (
    <>
      {drawer && navOpen && (
        <div aria-hidden onClick={() => setNavOpen(false)} className="fixed inset-0 z-40 bg-black/60" />
      )}
    <aside
      aria-label="Main navigation"
      // Inert while off-screen, so its links cannot be tabbed to.
      inert={hidden || undefined}
      className={clsx(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-bg transition-[width,transform] duration-200 ease-ease",
        collapsed ? "w-[var(--sidebar-w-collapsed)]" : "w-sidebar",
        hidden ? "-translate-x-full" : "translate-x-0",
        drawer && navOpen && "shadow-lg",
      )}
    >
      <div
        className={clsx(
          "flex h-16 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center" : "justify-between pl-5 pr-3",
        )}
      >
        {!collapsed && (
          <span className="flex items-center gap-2">
            <img src={brand.logoUrl} alt="" aria-hidden className="h-7 w-7 shrink-0 object-contain" />
            <span className="font-semibold">{brand.name}</span>
          </span>
        )}
        {drawer ? (
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="flex h-10 w-10 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <CloseIcon />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-border text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <PanelIcon />
          </button>
        )}
      </div>

      <nav className={clsx("flex-1 overflow-y-auto pb-4 pt-3", collapsed ? "px-2" : "px-3")}>
        {sections.map((section, i) => (
          <div key={section.title} className={clsx(i > 0 && (collapsed ? "mt-3" : "mt-4"))}>
            {collapsed ? (
              i > 0 && <div className="mx-2 mb-3 border-t border-border" aria-hidden />
            ) : (
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                {section.title}
              </p>
            )}

            {section.items.map(({ to, label, icon: Icon, end, badge }) => {
              const count = badge ? unreadNotifications : 0;
              const hint = collapsed ? (count ? `${label} (${count})` : label) : undefined;

              return (
                <NavLink
                  key={label}
                  to={to}
                  end={end}
                  title={hint}
                  aria-label={collapsed ? hint : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "relative",
                      itemClass(collapsed),
                      isActive
                        ? "bg-surface-active text-text"
                        : "text-text-muted hover:bg-surface-hover hover:text-text",
                    )
                  }
                >
                  <Icon />
                  {!collapsed && label}
                  {count > 0 && (
                    <span
                      aria-label={`${count} unread`}
                      className={clsx(
                        "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-pink px-1 text-[10px] font-bold text-text-inverse",
                        collapsed ? "absolute right-1.5 top-1" : "ml-auto",
                      )}
                    >
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={clsx("border-t border-border", collapsed ? "p-2" : "p-3")}>
        <AccountCard collapsed={collapsed} />
      </div>
    </aside>
    {/* Once per signed-in page load, here because the sidebar is on every one of them. */}
    <NotificationPopup />
    </>
  );
}

/**
 * The signed-in account, with sign-out behind it rather than beside it - a
 * destructive action that sits one stray click away gets clicked.
 */
function AccountCard({ collapsed }) {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    // Revoking server-side is best effort; the local session ends either way,
    // otherwise a network blip would leave someone stuck signed in.
    await authApi.logout().catch(() => {});
    clear();
    navigate("/login", { replace: true });
  };

  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className={clsx(
            "absolute bottom-full mb-2 overflow-hidden rounded border border-border-strong bg-surface-2 p-1 shadow-lg",
            collapsed ? "left-0 w-52" : "inset-x-0",
          )}
        >
          {collapsed && (
            <p className="truncate px-3 pb-1 pt-2 text-label text-text-faint">{user?.email}</p>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full rounded-sm px-3 py-2 text-left text-ui text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className={clsx(
          "flex w-full items-center gap-3 rounded border border-border transition-colors hover:border-border-strong",
          collapsed ? "justify-center p-1.5" : "px-3 py-2.5",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink text-ui font-semibold text-text-inverse">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-ui font-medium">{user?.name || "Signed in"}</span>
              <span className="block truncate text-label text-text-faint">{user?.email}</span>
            </span>
            <svg
              {...stroke}
              className={clsx("shrink-0 text-text-muted transition-transform", !open && "rotate-180")}
            >
              <path d="m4 10 4-4 4 4" />
            </svg>
          </>
        )}
      </button>
    </div>
  );
}

/* Inline so the sidebar carries no icon dependency for a handful of glyphs. */
const stroke = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "shrink-0",
};

function CloseIcon() {
  return (
    <svg {...stroke}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg {...stroke}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg {...stroke}>
      <path d="M2 6.5 8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5Z" />
      <path d="M6 14V9h4v5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...stroke}>
      <path d="M8 1.8 13 3.6v4c0 3-2.1 5.4-5 6.6-2.9-1.2-5-3.6-5-6.6v-4z" />
      <path d="M5.8 8l1.6 1.6L10.4 6.5" />
    </svg>
  );
}

function AvatarIcon() {
  return (
    <svg {...stroke}>
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg {...stroke}>
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11zM6.5 14a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...stroke}>
      <path d="M14 9.5a2 2 0 0 1-2 2H6l-3 2.5v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg {...stroke}>
      <path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5zM8 12v2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg {...stroke}>
      <path d="M2 13h12" />
      <path d="M4.5 13V8M8 13V4m3.5 9V9.5" />
    </svg>
  );
}
