import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { siteApi } from "@/services/site.api";
import Card from "@/components/common/Card";
import { Badge } from "@/components/forms/controls";
import PageHeader from "@/components/layout/PageHeader";
import { SafeHtml } from "@/features/admin/comms/shared";
import NotificationIcon from "./NotificationIcon";
import NotificationLink from "./NotificationLink";

const TINT = { high: "text-red", medium: "text-orange", low: "text-blue" };

const day = (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Everything published for the signed-in person, newest first.
 *
 * "NEW" is judged against the last visit as it was *before* this one: the page
 * marks everything seen only after the list has loaded, and keeps the list it
 * loaded (it is not refetched while open), so the badges stay for this visit
 * and are gone on the next.
 */
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const marked = useRef(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["site-notifications"],
    queryFn: siteApi.notifications,
    // Held as loaded for the whole visit, and fetched fresh on the next one.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data || marked.current) return;
    marked.current = true;
    siteApi
      .markSeen()
      .then(() => queryClient.invalidateQueries({ queryKey: ["site-notification-summary"] }))
      .catch(() => {});
  }, [data, queryClient]);

  const notifications = data?.notifications ?? [];

  return (
    <>
      <PageHeader title="Notifications" description="Stay updated with the latest news and announcements" />

      {isLoading ? (
        <div className="space-y-4" aria-busy>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-surface-2" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-ui text-red">Could not load your notifications.</p>
      ) : notifications.length === 0 ? (
        <Card className="py-12 text-center">
          <NotificationIcon name="Bell" size={48} className="mx-auto mb-4 text-text-faint" />
          <h3 className="text-h3 font-semibold">No Notifications Yet</h3>
          <p className="mt-2 text-ui text-text-muted">You're all caught up! Check back later for new announcements.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {notifications.map((n) => (
            <Card key={n._id} hover className={n.isNew ? "border-pink" : ""}>
              <div className="flex items-start gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${TINT[n.priority] || TINT.low}`}>
                  <NotificationIcon name={n.icon} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-h3 font-semibold">{n.title}</h3>
                    {n.isNew && <Badge className="bg-pink text-text-inverse">NEW</Badge>}
                  </div>
                  <SafeHtml html={n.message} className="mb-4 text-text-muted" />
                  <div className="flex flex-wrap items-center gap-4 text-ui">
                    <span className="text-text-muted">{day(n.publishDate || n.createdAt)}</span>
                    <NotificationLink url={n.linkUrl} text={n.linkText} className="inline-flex items-center gap-1 text-pink hover:underline" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
