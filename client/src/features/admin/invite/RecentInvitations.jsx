import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminUsersApi } from "@/services/admin.users.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { date } from "../format";

const STATUS_TONE = { pending: "yellow", accepted: "green", expired: "neutral" };

/** The last invitations sent, with what became of them - and a way to cancel a pending one. */
export default function RecentInvitations() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["admin-invitations"],
    queryFn: adminUsersApi.invitations,
  });

  const revoke = useMutation({
    mutationFn: (invitation) => adminUsersApi.revokeInvitation(invitation.id),
    onSuccess: () => {
      toast.success("Invitation revoked.");
      queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (err) => toast.error("Failed to revoke invitation.", { description: err.message }),
    onSettled: () => setRevoking(null),
  });

  return (
    <Card title="Recent invitations" className="mt-6">
      {error && <p className="mt-3 text-ui text-red">{error.message}</p>}
      {isLoading && <p className="mt-3 text-ui text-text-muted">Loading…</p>}
      {!isLoading && !error && data.length === 0 && <p className="mt-3 text-ui text-text-muted">No invitations yet.</p>}

      {data.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {data.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-ui font-medium">{invitation.email}</p>
                <p className="mt-0.5 text-label text-text-faint">
                  {invitation.plan?.name || "Plan removed"} · {invitation.role} · sent {date(invitation.createdAt)}
                  {invitation.status === "pending" && ` · expires ${date(invitation.expiresAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={STATUS_TONE[invitation.status]}>{invitation.status}</Badge>
                {invitation.status === "pending" && (
                  <Button variant="ghost" size="sm" className="hover:text-red" onClick={() => setRevoking(invitation)}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(revoking)}
        title={`Revoke the invitation to ${revoking?.email ?? ""}?`}
        message="The link stops working at once. You can send them a new invitation any time."
        confirmLabel="Revoke"
        busyLabel="Revoking…"
        busy={revoke.isPending}
        onConfirm={() => revoke.mutate(revoking)}
        onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}
