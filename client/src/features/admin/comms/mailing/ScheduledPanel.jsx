import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { EmptyState, Skeletons, errorText } from "../shared";
import ScheduleDialog from "./ScheduleDialog";

const STATUS_TONE = { pending: "yellow", sending: "blue", sent: "green", failed: "red", cancelled: "neutral" };

const when = (value) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

/** A short description of who an email is for. */
function audienceChips(audience) {
  if (!audience || audience.mode === "all") return [];
  const chips = [];
  if (audience.status && audience.status !== "all") chips.push(`Status: ${audience.status}`);
  if (audience.planIds?.length) chips.push(`${audience.planMode === "without" ? "Without" : "With"} ${audience.planIds.length} plan(s)`);
  if (audience.mode === "selected_users") chips.push(`${audience.userIds?.length || 0} selected user(s)`);
  if (audience.mode === "lists") chips.push(`${audience.listIds?.length || 0} list(s)`);
  return chips;
}

/** The Scheduled inner tab: what is waiting to go out, and what has. */
export default function ScheduledPanel() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const { data: emails = [], isLoading } = useQuery({ queryKey: ["admin-scheduled"], queryFn: commsApi.scheduled });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-scheduled"] });
    queryClient.invalidateQueries({ queryKey: ["admin-mail-stats"] });
  };

  const cancel = useMutation({
    mutationFn: (e) => commsApi.cancelScheduled(e._id),
    onSuccess: () => {
      toast.success("Scheduled email cancelled");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to cancel email")),
    onSettled: () => setCancelling(null),
  });

  const remove = useMutation({
    mutationFn: (e) => commsApi.deleteScheduled(e._id),
    onSuccess: () => {
      toast.success("Scheduled email deleted");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Failed to delete email")),
    onSettled: () => setDeleting(null),
  });

  const run = useMutation({
    mutationFn: commsApi.runScheduled,
    onSuccess: ({ processed }) => {
      toast.info(processed ? `Sent ${processed} due email${processed === 1 ? "" : "s"}` : "Nothing is due right now");
      refresh();
    },
    onError: (err) => toast.error(errorText(err, "Could not run the scheduled emails")),
  });

  const pending = emails.filter((e) => e.status === "pending" || e.status === "sending");
  const done = emails.filter((e) => e.status === "sent" || e.status === "failed");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending} title="Send anything that is already due, without waiting for the next minute">
          {run.isPending ? "Running..." : "Run due now"}
        </Button>
        <Button onClick={() => setCreating(true)}>+ Schedule New Email</Button>
      </div>

      {isLoading ? (
        <Skeletons />
      ) : (
        <>
          <Card title={`Pending Scheduled Emails (${pending.length})`}>
            {pending.length === 0 ? (
              <EmptyState icon="mail">No scheduled emails pending</EmptyState>
            ) : (
              <div className="mt-4 space-y-3">
                {pending.map((e) => (
                  <div key={e._id} className="rounded-lg border border-border bg-bg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-body font-semibold">{e.title || e.subject}</h4>
                          <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                        </div>
                        <p className="text-ui text-text-muted">
                          <strong className="text-text">Subject:</strong> {e.subject}
                        </p>
                        <p className="text-ui text-text-muted">
                          <strong className="text-text">Scheduled:</strong> {when(e.scheduledDate)}
                        </p>
                        {e.recipientCount !== undefined && (
                          <p className="text-ui text-text-muted">
                            <strong className="text-text">Recipients:</strong> {e.recipientCount} users
                          </p>
                        )}
                        <p className="text-label text-text-faint">
                          <strong>From:</strong> {e.fromName}
                        </p>
                        {audienceChips(e.audience).length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {audienceChips(e.audience).map((chip) => (
                              <Badge key={chip} tone="outline">
                                {chip}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" disabled={e.status !== "pending"} onClick={() => setCancelling(e)}>
                          Cancel
                        </Button>
                        <Button variant="danger" size="sm" disabled={e.status === "sending"} onClick={() => setDeleting(e)} aria-label={`Delete ${e.title || e.subject}`}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {done.length > 0 && (
            <Card title={`Sent Emails (${done.length})`}>
              <div className="mt-4 space-y-3">
                {done.map((e) => (
                  <div key={e._id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg p-3 text-ui">
                    <div className="min-w-0">
                      <span className="font-medium">{e.title || e.subject}</span>
                      <div className="mt-1 text-label text-text-muted">
                        {e.sentDate ? `Sent: ${when(e.sentDate)} • ` : ""}
                        {e.sentCount} delivered • {e.failedCount} failed
                        {e.status === "failed" && e.errorMessage ? ` • ${e.errorMessage}` : ""}
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <ScheduleDialog open={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel scheduled email"
        message="Are you sure you want to cancel this scheduled email?"
        confirmLabel="Cancel email"
        cancelLabel="Keep it"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate(cancelling)}
        onCancel={() => setCancelling(null)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete scheduled email"
        message="Are you sure you want to delete this scheduled email?"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
