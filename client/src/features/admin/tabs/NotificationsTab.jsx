import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import NotificationIcon from "@/features/site/NotificationIcon";
import NotificationDialog from "../comms/NotificationDialog";
import { EmptyState, SearchBox, Skeletons, errorText, stripHtml } from "../comms/shared";

const STATUSES = ["all", "published", "draft", "archived"];
const PRIORITY_TONE = { high: "red", medium: "yellow", low: "blue" };
const STATUS_ICON = {
  published: ["CheckCircle", "text-green"],
  archived: ["Info", "text-text-faint"],
  draft: ["AlertCircle", "text-yellow"],
};

const day = (value) =>
  new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** In-app announcements: write them, schedule them, choose who sees them and how. */
export default function NotificationsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const { data: notifications = [], isLoading } = useQuery({ queryKey: ["admin-notifications"], queryFn: commsApi.notifications });

  const remove = useMutation({
    mutationFn: (n) => commsApi.deleteNotification(n._id),
    onSuccess: () => {
      toast.success("Notification deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
    },
    onError: (err) => toast.error(errorText(err, "Failed to delete notification")),
    onSettled: () => setDeleting(null),
  });

  const open = (notification = null) => {
    setEditing(notification);
    setDialogOpen(true);
  };

  const q = search.toLowerCase();
  const shown = notifications.filter(
    (n) =>
      (status === "all" || n.status === status) &&
      (n.title.toLowerCase().includes(q) || stripHtml(n.message).toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-h2">App Notifications</h2>
          <p className="mt-1 text-ui text-text-muted">Create and manage in-app announcements for your users</p>
        </div>
        <Button onClick={() => open()}>+ Create Notification</Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search notifications..." />
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <Button key={s} size="sm" variant={status === s ? "primary" : "secondary"} onClick={() => setStatus(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Skeletons />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon="bell"
            title="No Notifications Found"
            action={
              !search && status === "all" ? <Button onClick={() => open()}>+ Create Notification</Button> : null
            }
          >
            {search || status !== "all" ? "Try adjusting your search or filters" : "Create your first notification to get started"}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((n) => {
            const [icon, tone] = STATUS_ICON[n.status] || STATUS_ICON.draft;
            return (
              <Card key={n._id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <NotificationIcon name={icon} size={16} className={tone} />
                      <h3 className="text-body font-semibold">{n.title}</h3>
                      <Badge tone={PRIORITY_TONE[n.priority] || "blue"}>{n.priority}</Badge>
                      <Badge tone="outline">{n.displayType === "popup_and_bell" ? "Popup" : "Bell Only"}</Badge>
                    </div>
                    <p className="mt-2 line-clamp-2 text-ui text-text-muted">{stripHtml(n.message)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-label text-text-faint">
                      <span>{n.publishDate ? day(n.publishDate) : "Not scheduled"}</span>
                      <Badge tone="outline">{n.status}</Badge>
                      {n.targetRoles?.length > 0 && <span>👥 {n.targetRoles.join(", ")}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => open(n)} aria-label={`Edit ${n.title}`}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(n)} aria-label={`Delete ${n.title}`} className="text-red">
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NotificationDialog open={dialogOpen} notification={editing} onClose={() => setDialogOpen(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete notification"
        message={deleting ? `Are you sure you want to delete "${deleting.title}"?` : ""}
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
