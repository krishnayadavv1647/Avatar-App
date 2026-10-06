import { lazy } from "react";

/**
 * The admin panel's tabs, grouped the way the dropdown nav shows them.
 *
 * Adding a tab is one entry here plus its component in ./tabs. Each component
 * is loaded on first use, so the panel opens without pulling in every screen.
 *
 * Query keys used by a tab must start with "admin" - the panel's Refresh
 * button reloads everything under that prefix.
 */
export const CATEGORIES = [
  {
    label: "Users & Access",
    icon: "users",
    tabs: [
      { value: "users", icon: "users", label: "Users", component: lazy(() => import("./tabs/UsersTab")) },
      { value: "avatars", icon: "image", label: "Avatars", component: lazy(() => import("./tabs/AvatarsTab")) },
      { value: "invite", icon: "invite", label: "Invite User", component: lazy(() => import("./tabs/InviteTab")) },
      { value: "plans", icon: "plan", label: "Plans", component: lazy(() => import("./tabs/PlansTab")) },
      { value: "credits", icon: "coins", label: "Credits", component: lazy(() => import("./tabs/CreditsTab")) },
    ],
  },
  {
    label: "Dashboard & UI",
    icon: "layers",
    tabs: [
      { value: "dashboard_cards", icon: "layers", label: "Dashboard Cards", component: lazy(() => import("./tabs/DashboardCardsTab")) },
      { value: "hero_banners", icon: "image", label: "Hero Banners", component: lazy(() => import("./tabs/HeroBannersTab")) },
      { value: "notifications", icon: "bell", label: "Notifications", component: lazy(() => import("./tabs/NotificationsTab")) },
    ],
  },
  {
    label: "Comms & Mailing",
    icon: "mail",
    tabs: [
      { value: "mailing", icon: "mail", label: "Mailing", component: lazy(() => import("./tabs/MailingTab")) },
      { value: "support_mailbox", icon: "inbox", label: "Support Mailbox", component: lazy(() => import("./tabs/SupportMailboxTab")) },
    ],
  },
  {
    label: "System & Config",
    icon: "settings",
    tabs: [
      { value: "api_settings", icon: "key", label: "API Keys", component: lazy(() => import("./tabs/ApiKeysTab")) },
      { value: "analytics", icon: "chart", label: "Analytics", component: lazy(() => import("./tabs/AnalyticsTab")) },
      { value: "credit_usage", icon: "coins", label: "Credit Usage", component: lazy(() => import("./tabs/CreditUsageTab")) },
      { value: "settings", icon: "settings", label: "App Config", component: lazy(() => import("./tabs/AppConfigTab")) },
      { value: "errors", icon: "alert", label: "Error Logs", component: lazy(() => import("./tabs/ErrorLogsTab")) },
    ],
  },
];

export const TABS = CATEGORIES.flatMap((c) => c.tabs);
export const DEFAULT_TAB = "users";
