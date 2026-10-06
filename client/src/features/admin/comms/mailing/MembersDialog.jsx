import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import Field from "@/components/forms/Field";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import Icon from "../../icons";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Add and remove the addresses on one list. The server enforces the duplicate rule; this checks first for a quicker message. */
export default function MembersDialog({ list, onClose }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState(null);

  const key = ["admin-list-members", list?._id];
  const { data: members = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: key,
    queryFn: () => commsApi.members(list._id),
    enabled: Boolean(list),
  });

  // The list cards show live counts, so every change here refreshes them.
  const changed = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["admin-lists"] });
  };

  const add = useMutation({
    mutationFn: () => commsApi.addMember(list._id, { email: email.trim(), ...(name.trim() && { fullName: name.trim() }) }),
    onSuccess: (member) => {
      toast.success(`${member.email} added to the list!`);
      setEmail("");
      setName("");
      changed();
    },
    onError: (err) => toast.error(err.status === 409 ? err.message : `Failed to add member: ${err.message}`),
  });

  const remove = useMutation({
    mutationFn: (member) => commsApi.removeMember(list._id, member._id),
    onSuccess: () => {
      toast.success("Member removed successfully");
      changed();
    },
    onError: () => toast.error("Failed to remove member"),
    onSettled: () => setRemoving(null),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Please enter an email address");
    if (!EMAIL.test(email.trim())) return toast.error("Please enter a valid email address");
    if (members.some((m) => m.email === email.trim().toLowerCase())) return toast.error("This email is already in the list");
    add.mutate();
  };

  return (
    <>
      <Modal
        open={Boolean(list)}
        onClose={onClose}
        title={`Manage Members - ${list?.name ?? ""}`}
        description={`Add or remove email addresses from this list. Current members: ${members.length}`}
      >
        <div className="space-y-6">
          <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-bg p-4">
            <h4 className="text-ui font-semibold">+ Add New Member</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Field label="Email Address *" id="member-email" type="email" value={email} onChange={setEmail} placeholder="user@example.com" />
              </div>
              <div>
                <Field label="Full Name (Optional)" id="member-name" value={name} onChange={setName} placeholder="John Doe" />
              </div>
            </div>
            <Button type="submit" fullWidth disabled={add.isPending || !email}>
              {add.isPending ? "Adding..." : "Add Member"}
            </Button>
          </form>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-ui font-semibold">Current Members ({members.length})</h4>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh members">
                <Icon name="refresh" size={14} className={isFetching ? "animate-spin" : ""} />
              </Button>
            </div>

            {isLoading ? (
              <p className="py-8 text-center text-ui text-text-muted">Loading…</p>
            ) : members.length === 0 ? (
              <p className="py-8 text-center text-ui text-text-muted">No members yet. Add your first member above.</p>
            ) : (
              <div className="max-h-[300px] space-y-2 overflow-y-auto rounded-lg border border-border bg-bg p-3">
                {members.map((m) => (
                  <div key={m._id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-ui font-medium">{m.email}</p>
                        <Badge tone={m.status === "active" ? "green" : "red"}>{m.status}</Badge>
                        {m.userId && <Badge tone="outline">Registered User</Badge>}
                      </div>
                      {m.fullName && <p className="mt-1 text-label text-text-muted">{m.fullName}</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="text-red" onClick={() => setRemoving(m)} aria-label={`Remove ${m.email}`}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove member"
        message={removing ? `Remove ${removing.email} from this list?` : ""}
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
