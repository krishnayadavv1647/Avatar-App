import { useQuery } from "@tanstack/react-query";
import { siteApi } from "@/services/site.api";
import { useAuth } from "@/store/auth.store";

/**
 * The sidebar badge count and the popup to show, if any. Shared by the sidebar
 * and the popup so one request serves both. Re-checked every few minutes and
 * when the tab regains focus, so a notification an admin just published shows
 * up without a reload.
 */
export function useNotificationSummary() {
  const signedIn = useAuth((s) => Boolean(s.accessToken));
  return useQuery({
    queryKey: ["site-notification-summary"],
    queryFn: siteApi.summary,
    enabled: signedIn,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    // Cosmetic: a failure leaves the badge off rather than breaking the page.
    retry: 0,
  });
}
