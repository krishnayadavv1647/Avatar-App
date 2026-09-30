import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { timeAgo } from "@/utils/timeAgo";
import AdminGate from "./AdminGate";
import DailyChart from "./DailyChart";
import { Stat, Th } from "./parts";
import { compact, date, money } from "./format";

/**
 * The admin overview: the platform at a glance, then every user.
 *
 * The figures refresh every 30 seconds so a call starting or ending shows up
 * without a reload - this is a page people leave open to watch.
 */
export default function AdminOverview() {
  return (
    <AdminGate>
      <PageHeader title="Admin" description="Every user and call across the platform." />
      <Overview />
      <Users />
    </AdminGate>
  );
}

function Overview() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: adminApi.overview,
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-text-muted">Loading overview…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Users"
          value={compact(data.users.total)}
          detail={`+${data.users.new7d} this week${data.users.blocked ? ` · ${data.users.blocked} blocked` : ""}`}
        />
        <Stat
          label="Active users"
          value={compact(data.users.active7d)}
          detail="Signed in or called, last 7 days"
        />
        <Stat
          label="Calls, last 7 days"
          value={compact(data.calls.last7d)}
          detail={`${data.calls.last24h} today · ${compact(data.calls.total)} all time`}
        />
        <Stat
          label="Minutes, last 7 days"
          value={compact(data.minutes.last7d)}
          detail={`${money(data.costCents.last7d)} estimated cost`}
        />
        <Stat
          label="Live now"
          value={String(data.calls.live)}
          detail={`${compact(data.avatars.total)} avatars in total`}
          live={data.calls.live > 0}
        />
      </div>

      <Card className="mt-4">
        <DailyChart days={data.daily} timezone={data.timezone} />
      </Card>

      {data.liveCalls.length > 0 && (
        <Card className="mt-4" title="Live calls">
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-ui">
              <thead>
                <tr className="text-text-faint">
                  <Th>User</Th>
                  <Th>Avatar</Th>
                  <Th>Joined via</Th>
                  <Th align="right">Started</Th>
                </tr>
              </thead>
              <tbody>
                {data.liveCalls.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2.5">{c.user?.email || "—"}</td>
                    <td className="py-2.5">{c.avatar}</td>
                    <td className="py-2.5 text-text-muted">
                      {c.source === "link" ? `Share link${c.guest ? ` · ${c.guest}` : ""}` : c.source === "meeting" ? "Meeting" : "App"}
                    </td>
                    <td className="py-2.5 text-right text-text-muted">{timeAgo(c.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Users() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Searches once typing pauses, and from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["admin-users", q, page],
    queryFn: () => adminApi.users({ q, page }),
    placeholderData: keepPreviousData,
  });

  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Users</p>
          <p className="mt-0.5 text-ui text-text-muted">
            Avatars, calls and minutes are counted per workspace.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name"
          aria-label="Search users"
          className="h-10 w-72 rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
        />
      </div>

      {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
      {isLoading && <p className="mt-4 text-ui text-text-muted">Loading users…</p>}

      {data && (
        <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-ui">
              <thead>
                <tr className="text-text-faint">
                  <Th>User</Th>
                  <Th>Plan</Th>
                  <Th>Signed up</Th>
                  <Th>Last active</Th>
                  <Th align="right">Avatars</Th>
                  <Th align="right">Calls</Th>
                  <Th align="right">Minutes</Th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => {
                  const lastActive = [u.lastLoginAt, u.lastCallAt].filter(Boolean).sort().at(-1);
                  const open = () => navigate(`/admin/users/${u.id}`);
                  return (
                    <tr
                      key={u.id}
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => e.key === "Enter" && open()}
                      className="cursor-pointer border-t border-border transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                    >
                      <td className="py-2.5 pr-4">
                        <p className="flex items-center gap-2">
                          <span className="font-medium">{u.name || u.email.split("@")[0]}</span>
                          {u.admin && (
                            <span className="rounded-full bg-pink-dim px-2 py-0.5 text-label text-pink">Admin</span>
                          )}
                          {u.blocked && (
                            <span className="rounded-full bg-red-dim px-2 py-0.5 text-label text-red">Blocked</span>
                          )}
                        </p>
                        <p className="text-text-muted">{u.email}</p>
                      </td>
                      <td className="py-2.5 text-text-muted">{u.plan || "—"}</td>
                      <td className="py-2.5 text-text-muted">{date(u.createdAt)}</td>
                      <td className="py-2.5 text-text-muted">{lastActive ? timeAgo(lastActive) : "Never"}</td>
                      <td className="py-2.5 text-right tabular-nums">{u.avatars}</td>
                      <td className="py-2.5 text-right tabular-nums">{u.calls}</td>
                      <td className="py-2.5 text-right tabular-nums">{u.minutes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.users.length === 0 ? (
            <p className="mt-4 text-ui text-text-muted">No users match “{q}”.</p>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3 text-ui text-text-muted">
              <span>
                {from}–{to} of {data.total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
