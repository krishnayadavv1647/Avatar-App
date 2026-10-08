import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamApi } from "@/services/team.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import UserAvatar from "@/components/common/UserAvatar";
import { Badge, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import AddMemberDialog from "./AddMemberDialog";
import ResetPasswordDialog from "./ResetPasswordDialog";
import InviteLinkDialog from "./InviteLinkDialog";

/**
 * The people in this workspace. They share its avatars, plan and credits; what
 * differs is what they may change. The owner runs everything, an admin runs
 * the team, a member just uses the avatars. The server enforces all of it;
 * this page only hides what would be refused.
 */
const ROLE_TONE = { owner: "purple", admin: "blue", member: "neutral" };
const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" };

const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");

export default function TeamPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["team"], queryFn: teamApi.list, retry: false });
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [removing, setRemoving] = useState(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["team"] });
  // Only managers get here (the page above refuses everyone else), so this never asks for what it may not have.
  const { data: invitesData } = useQuery({ queryKey: ["team-invites"], queryFn: teamApi.invites, enabled: Boolean(data) });
  const refreshInvites = () => queryClient.invalidateQueries({ queryKey: ["team-invites"] });

  const revokeInvite = useMutation({
    mutationFn: (id) => teamApi.revokeInvite(id),
    onSuccess: () => {
      toast.success("Invite link cancelled");
      refreshInvites();
    },
    onError: (err) => toast.error(err.message),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }) => teamApi.update(id, { role }),
    onSuccess: ({ member }) => {
      toast.success(`${member.name || member.email} is now ${ROLE_LABEL[member.role].toLowerCase()}`);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => teamApi.remove(id),
    onSuccess: () => {
      toast.success("Removed from the workspace");
      setRemoving(null);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-text-muted">Loading…</p>;
  if (error?.status === 403) {
    return (
      <>
        <PageHeader title="Team" />
        <Card>
          <p className="text-text-muted">Only the workspace owner or an admin can manage the team.</p>
        </Card>
      </>
    );
  }
  if (error) return <p className="text-red">{error.message}</p>;

  const { members, me, role: myRole } = data;
  // What the server would allow, so the buttons shown are the ones that work.
  const manageable = (m) => m.id !== me && m.role !== "owner" && (myRole === "owner" || m.role === "member");
  const rolesICanGive = myRole === "owner" ? ["admin", "member"] : ["member"];

  return (
    <>
      <PageHeader
        title="Team"
        description="Add the people you work with. They sign in with their own email and password and share this workspace's avatars and credits."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setInviting(true)}>
              Invite by link
            </Button>
            <Button onClick={() => setAdding(true)}>Add user</Button>
          </div>
        }
      />

      <Card flush>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
              <UserAvatar user={m} size={40} />

              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-ui font-medium">
                  <span className="truncate">{m.name || m.email}</span>
                  {m.id === me && <Badge tone="outline">You</Badge>}
                </p>
                <p className="truncate text-label text-text-faint">
                  {m.name ? m.email : null}
                  {m.title ? `${m.name ? " · " : ""}${m.title}` : null}
                </p>
              </div>

              <p className="hidden text-label text-text-faint md:block md:w-36">Last sign-in {when(m.lastLoginAt)}</p>

              <div className="flex items-center gap-2">
                {manageable(m) ? (
                  <Select
                    value={m.role}
                    onChange={(role) => changeRole.mutate({ id: m.id, role })}
                    aria-label={`Role of ${m.name || m.email}`}
                    disabled={changeRole.isPending}
                    className="w-32"
                  >
                    {rolesICanGive.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>
                )}

                {manageable(m) && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setResetting(m)}>
                      Reset password
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {invitesData?.invites?.length > 0 && (
        <Card title="Open invite links" className="mt-4">
          <p className="mt-2 text-ui text-text-muted">
            Anyone with one of these can create an account here. Cancel a link to stop it working at once.
          </p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-bg">
            {invitesData.invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-ui font-medium">
                    Joins as {inv.role}
                    {inv.email ? ` · only ${inv.email}` : ""}
                  </p>
                  <p className="text-label text-text-faint">
                    {inv.uses} of {inv.maxUses} used · expires {when(inv.expiresAt)}
                    {inv.createdBy ? ` · made by ${inv.createdBy}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revokeInvite.mutate(inv.id)} disabled={revokeInvite.isPending && revokeInvite.variables === inv.id}>
                  Cancel link
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="What each role can do" className="mt-4">
        <dl className="mt-3 grid gap-4 text-ui sm:grid-cols-3">
          <div>
            <dt className="font-medium">Owner</dt>
            <dd className="mt-1 text-text-muted">Everything, including billing, the team and renaming the workspace. Cannot be removed.</dd>
          </div>
          <div>
            <dt className="font-medium">Admin</dt>
            <dd className="mt-1 text-text-muted">Adds and manages members, and buys credits. Cannot touch the owner or other admins.</dd>
          </div>
          <div>
            <dt className="font-medium">Member</dt>
            <dd className="mt-1 text-text-muted">Creates and talks to avatars with the workspace's credits. Cannot see the team or buy credits.</dd>
          </div>
        </dl>
      </Card>

      <AddMemberDialog
        open={adding}
        roles={rolesICanGive}
        onClose={() => setAdding(false)}
        onCreated={refresh}
      />
      <InviteLinkDialog open={inviting} roles={rolesICanGive} onClose={() => setInviting(false)} onCreated={refreshInvites} />
      <ResetPasswordDialog member={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name || removing?.email || "this person"}?`}
        message="They are signed out at once and can no longer sign in. The avatars and conversations they made stay in the workspace."
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
