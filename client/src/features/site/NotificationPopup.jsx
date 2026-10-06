import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { siteApi } from "@/services/site.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { SafeHtml } from "@/features/admin/comms/shared";
import NotificationIcon from "./NotificationIcon";
import NotificationLink from "./NotificationLink";
import { useNotificationSummary } from "./useNotificationSummary";

const day = (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The popup for a notification an admin marked "Popup + Bell". Shown once:
 * closing it records that the person has seen everything up to now, which also
 * clears the sidebar badge, so it does not come back on the next page.
 *
 * Mounted once, in the sidebar, so it covers every signed-in page.
 */
export default function NotificationPopup() {
  const queryClient = useQueryClient();
  const { data } = useNotificationSummary();
  // Hides it the moment it is closed, before the server round trip finishes.
  const [dismissed, setDismissed] = useState(null);

  const popup = data?.popup && data.popup._id !== dismissed ? data.popup : null;

  const close = async () => {
    if (!popup) return;
    setDismissed(popup._id);
    try {
      await siteApi.markSeen();
    } finally {
      queryClient.invalidateQueries({ queryKey: ["site-notification-summary"] });
      queryClient.invalidateQueries({ queryKey: ["site-notifications"] });
    }
  };

  return (
    <Modal
      open={Boolean(popup)}
      onClose={close}
      title={popup?.title ?? ""}
      footer={
        popup && (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-label text-text-faint">{day(popup.publishDate || popup.createdAt)}</span>
            <div className="flex gap-2">
              <NotificationLink
                url={popup.linkUrl}
                text={popup.linkText}
                onNavigate={close}
                className="inline-flex h-10 items-center gap-2 rounded bg-pink px-4 text-ui font-medium text-text-inverse transition-colors hover:bg-pink-soft"
              />
              <Button variant="secondary" onClick={close}>
                Got it
              </Button>
            </div>
          </div>
        )
      }
    >
      {popup && (
        <div className="flex gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-pink">
            <NotificationIcon name={popup.icon} size={20} />
          </span>
          <SafeHtml html={popup.message} className="min-w-0 flex-1 text-text-muted" />
        </div>
      )}
    </Modal>
  );
}
