import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { adminApi } from "@/services/admin.api";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import MediaPreview from "@/components/media/MediaPreview";
import { timeAgo } from "@/utils/timeAgo";
import AdminGate from "./AdminGate";
import { Stat, Th } from "./parts";
import { compact, date, dateTime, duration, money } from "./format";
import { SOURCE_LABEL } from "./users/userUi";
import ActAsUserDialog from "./users/ActAsUserDialog";
import { useActAsUser } from "./impersonation";

/**
 * One user, as an admin sees them: their account, their plan, their
 * workspace's avatars, and its last 50 calls.
 *
 * Two things here change the account - blocking and assigning a plan - and
 * both ask first. The server records each in the workspace's audit log.
 */
export default function AdminUser() {
  return (
    <AdminGate>
      <Detail />
    </AdminGate>
  );
}

const STATUS_TONE = {
  active: "bg-green-dim text-green",
  ended: "bg-surface-3 text-text-muted",
  pending: "bg-surface-3 text-yellow",
  failed: "bg-red-dim text-red",
};

function Detail() {
  const { id } = useParams();
  const act = useActAsUser();
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => adminApi.user(id),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-text-muted">Loading user…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  const { user, workspace, subscription, stats, avatars, conversations } = data;

  return (
    <>
      <Link to="/admin?tab=users" className="text-ui text-text-muted hover:text-text">
        ← Users
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3">
            {user.name || user.email.split("@")[0]}
            {user.admin && <span className="rounded-full bg-pink-dim px-2.5 py-0.5 text-label text-pink">Admin</span>}
            {user.blocked && <span className="rounded-full bg-red-dim px-2.5 py-0.5 text-label text-red">Blocked</span>}
          </h1>
          <p className="mt-1.5 text-text-muted">{user.email}</p>
          <p className="mt-1 text-ui text-text-faint">
            {workspace?.name || "No workspace"} · signed up {date(user.createdAt)} · last sign-in{" "}
            {user.lastLoginAt ? timeAgo(user.lastLoginAt) : "never"}
            {user.organization && ` · ${user.organization}`} · {SOURCE_LABEL[user.source] || "Sign-up"}
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => act.ask(user)}
            disabled={user.admin}
            title={user.admin ? "Admins can't be impersonated." : "See the app as this user, and make changes for them."}
          >
            Act as user
          </Button>
          <BlockControl user={user} />
        </div>
      </header>
      <ActAsUserDialog act={act} />

      {user.blocked && (
        <p className="mb-4 rounded border border-red-line bg-red-dim px-4 py-3 text-ui text-red">
          Blocked {timeAgo(user.blockedAt)}
          {user.blockedBy && ` by ${user.blockedBy}`}
          {user.blockedReason && ` — “${user.blockedReason}”`}. They cannot sign in, and their avatars do not
          answer share links.
        </p>
      )}

      <PlanCard userId={user.id} subscription={subscription} limits={data.limits} used={data.minutesThisMonth} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Avatars" value={String(stats.avatars)} detail={`${stats.documents} knowledge documents`} />
        <Stat label="Calls" value={compact(stats.calls)} detail={`${stats.calls7d} in the last 7 days`} />
        <Stat label="Minutes" value={compact(stats.minutes)} detail="All time" />
        <Stat label="Estimated cost" value={money(stats.costCents)} detail="All time" />
        <Stat
          label="Last call"
          value={stats.lastCallAt ? timeAgo(stats.lastCallAt) : "Never"}
          detail={stats.lastCallAt ? dateTime(stats.lastCallAt) : "No calls yet"}
        />
      </div>

      <Card className="mt-4" title={`Avatars (${avatars.length})`}>
        {avatars.length === 0 ? (
          <p className="mt-3 text-ui text-text-muted">No avatars yet.</p>
        ) : (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {avatars.map((a) => (
              <div key={a._id} className="overflow-hidden rounded border border-border bg-surface-2">
                <MediaPreview src={a.previewUrl} className="aspect-[4/5] w-full object-cover" />
                <div className="p-3">
                  <p className="truncate text-ui font-medium" title={a.name}>
                    {a.name}
                  </p>
                  <p className="mt-0.5 truncate text-label text-text-faint">
                    {a.status} · {a.providerId} · {date(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Recent calls">
        {conversations.length === 0 ? (
          <p className="mt-3 text-ui text-text-muted">No calls yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-ui">
              <thead>
                <tr className="text-text-faint">
                  <Th>When</Th>
                  <Th>Avatar</Th>
                  <Th>Joined via</Th>
                  <Th>Status</Th>
                  <Th align="right">Duration</Th>
                  <Th align="right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2.5 text-text-muted">{dateTime(c.startedAt)}</td>
                    <td className="py-2.5">{c.avatar}</td>
                    <td className="py-2.5 text-text-muted">
                      {c.source === "link" ? `Share link${c.guest ? ` · ${c.guest}` : ""}` : c.source === "meeting" ? "Meeting" : "App"}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={clsx("rounded-full px-2.5 py-0.5 text-label", STATUS_TONE[c.status])}
                        title={c.endReason || undefined}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{duration(c.durationSec)}</td>
                    <td className="py-2.5 text-right tabular-nums">{money(c.costCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Puts a freshly returned user into the page and refreshes the lists around it. */
function useUserUpdate(id) {
  const queryClient = useQueryClient();
  return (data) => {
    queryClient.setQueryData(["admin-user", String(id)], data);
    for (const key of ["admin-users", "admin-overview", "admin-plans", "admin-stats"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

function BlockControl({ user }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const update = useUserUpdate(user.id);

  const block = useMutation({
    mutationFn: () => adminApi.block(user.id, reason.trim()),
    onSuccess: (data) => {
      update(data);
      setOpen(false);
      setReason("");
    },
  });
  const unblock = useMutation({
    mutationFn: () => adminApi.unblock(user.id),
    onSuccess: update,
  });

  if (user.blocked) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button variant="secondary" onClick={() => unblock.mutate()} disabled={unblock.isPending}>
          {unblock.isPending ? "Unblocking…" : "Unblock user"}
        </Button>
        {unblock.isError && <p className="text-ui text-red">{unblock.error.message}</p>}
      </div>
    );
  }

  return (
    <>
      <Button
        variant="danger"
        onClick={() => setOpen(true)}
        disabled={user.admin}
        title={user.admin ? "Admins cannot be blocked. Demote them first." : undefined}
      >
        Block user
      </Button>

      <Modal
        open={open}
        onClose={() => !block.isPending && setOpen(false)}
        title={`Block ${user.email}?`}
        description="They are signed out everywhere and cannot sign back in. Calls they have running end now, and their avatars stop answering share links. You can unblock them later."
        footer={
          <>
            {block.isError && <span className="mr-auto text-ui text-red">{block.error.message}</span>}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={block.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => block.mutate()} disabled={block.isPending}>
              {block.isPending ? "Blocking…" : "Block user"}
            </Button>
          </>
        }
      >
        <label className="block text-ui text-text-muted" htmlFor="block-reason">
          Reason (optional, only admins see it)
        </label>
        <textarea
          id="block-reason"
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Spam, abuse, unpaid invoice…"
          className="mt-2 w-full resize-y rounded border border-border bg-bg px-3 py-2.5 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
        />
      </Modal>
    </>
  );
}

/** The user's plan, what it allows, how much of it is used - and a way to change it. */
function PlanCard({ userId, subscription, limits, used }) {
  const update = useUserUpdate(userId);
  const [choice, setChoice] = useState("");

  const { data: plans = [] } = useQuery({ queryKey: ["admin-plans"], queryFn: adminApi.plans });
  const assignable = plans.filter((p) => p.active);
  const current = subscription?.planId ? String(subscription.planId) : "";
  const selected = choice || current;

  const assign = useMutation({
    mutationFn: () => adminApi.assignPlan(userId, selected),
    onSuccess: (data) => {
      update(data);
      setChoice("");
    },
  });

  const minutesLine = limits
    ? limits.includedMinutes
      ? `${used} of ${limits.allowanceMinutes ?? limits.includedMinutes} min used this month${limits.bonusMinutes ? ` (${limits.includedMinutes} plan + ${limits.bonusMinutes} bonus)` : ""}${limits.overageEnabled ? ", overage on" : ""}`
      : `${used} min used this month · no monthly cap`
    : "—";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ui text-text-muted">Plan</p>
          <p className="mt-1 text-h3 font-semibold">
            {subscription?.planName || subscription?.plan || "None"}
            {!subscription?.planId && subscription?.plan && (
              <span className="ml-2 text-ui font-normal text-text-faint">(not an admin plan)</span>
            )}
          </p>
          <p className="mt-1 text-ui text-text-faint">
            {minutesLine}
            {limits && ` · ${limits.concurrencyLimit} call${limits.concurrencyLimit === 1 ? "" : "s"} at once`}
            {limits &&
              ` · ${limits.maxAvatars ? `up to ${limits.maxAvatars} avatar${limits.maxAvatars === 1 ? "" : "s"}` : "unlimited avatars"}`}
            {subscription?.assignedAt && ` · assigned ${timeAgo(subscription.assignedAt)}`}
          </p>
        </div>

        {assignable.length === 0 ? (
          <Link to="/admin?tab=plans" className="text-ui text-pink hover:underline">
            Create a plan to assign one
          </Link>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setChoice(e.target.value)}
              aria-label="Plan to assign"
              className="h-10 min-w-[200px] rounded border border-border bg-bg px-3 text-ui text-text outline-none [color-scheme:dark] focus:border-border-strong"
            >
              {!current && <option value="">Choose a plan…</option>}
              {assignable.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                  {p.priceCents ? ` · ${money(p.priceCents)}/mo` : ""}
                </option>
              ))}
            </select>
            <Button onClick={() => assign.mutate()} disabled={!selected || selected === current || assign.isPending}>
              {assign.isPending ? "Assigning…" : "Assign plan"}
            </Button>
          </div>
        )}
      </div>
      {assign.isError && <p className="mt-3 text-ui text-red">{assign.error.message}</p>}
    </Card>
  );
}
