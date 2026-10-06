import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import { adminSystemApi } from "@/services/admin.system.api";
import Card from "@/components/common/Card";
import { Badge } from "@/components/forms/controls";
import { timeAgo } from "@/utils/timeAgo";
import DailyChart from "../DailyChart";
import { Stat, Th } from "../parts";
import { compact, money } from "../format";
import { Glyph, QueryState, TabHeader, sentence } from "../system/parts";

/**
 * Analytics: the platform at a glance (the old Overview), then this calendar
 * month's figures, the five most active users and the latest calls.
 *
 * Refreshes every 30 seconds so a call starting or ending shows up without a
 * reload - the same behaviour the Overview had.
 */
export default function AnalyticsTab() {
  return (
    <div className="space-y-6">
      <Overview />
      <Month />
    </div>
  );
}

/* ------------------------------------------------------------------ overview */

function Overview() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: adminApi.overview,
    refetchInterval: 30_000,
  });

  if (isLoading || error) return <QueryState isLoading={isLoading} error={error} onRetry={refetch} loading="Loading overview…" />;

  return (
    <section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Users"
          value={compact(data.users.total)}
          detail={`+${data.users.new7d} this week${data.users.blocked ? ` · ${data.users.blocked} blocked` : ""}`}
        />
        <Stat label="Active users" value={compact(data.users.active7d)} detail="Signed in or called, last 7 days" />
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
    </section>
  );
}

/* --------------------------------------------------------------- this month */

const SOURCE = {
  app: { icon: "app", label: "App call" },
  link: { icon: "link", label: "Share link call" },
  meeting: { icon: "meeting", label: "Meeting call" },
};

function Month() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: adminSystemApi.analytics,
    refetchInterval: 30_000,
  });

  if (isLoading || error) return <QueryState isLoading={isLoading} error={error} onRetry={refetch} />;

  const { month } = data;

  return (
    <section>
      <TabHeader title="This month" description="Calls, minutes and new avatars since the 1st, against last month." />

      <div className="grid gap-4 md:grid-cols-3">
        <TrendStat label="Calls" icon="calls" metric={month.calls} />
        <TrendStat label="Minutes" icon="clock" metric={month.minutes} />
        <TrendStat label="Avatars created" icon="avatar" metric={month.avatars} />
      </div>

      <Card className="mt-4" title="Top Active Users">
        {data.topUsers.length === 0 ? (
          <p className="mt-4 text-ui text-text-muted">No calls this month yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.topUsers.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-dim text-label font-semibold text-pink">
                    {(u.name || u.email).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.name || "User"}</p>
                    <p className="truncate text-ui text-text-muted">{u.email}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone="purple">{u.minutes} min</Badge>
                  {u.plan && <p className="mt-1 text-label text-text-faint">{u.plan} plan</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4" title="Recent Activity">
        {data.recent.length === 0 ? (
          <p className="mt-4 text-ui text-text-muted">No activity yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.recent.map((a) => {
              const source = SOURCE[a.source] || SOURCE.app;
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-muted">
                      <Glyph name={source.icon} size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{sentence(source.label)}</p>
                      <p className="truncate text-ui text-text-muted">
                        {a.avatar} · {a.user || a.guest || "Guest"} · {timeAgo(a.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge tone="outline">{a.minutes} min</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

/**
 * A month figure with its change against last month. The change is hidden when
 * last month had nothing, rather than shown as an invented percentage.
 */
function TrendStat({ label, icon, metric }) {
  const { value, change } = metric;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-ui text-text-muted">{label}</p>
          <p className="mt-2 text-h2 font-semibold">{compact(value)}</p>
        </div>
        <Glyph name={icon} size={28} className="text-text-faint" />
      </div>
      {change !== null && (
        <p className={`mt-2 flex items-center gap-1 text-ui ${change < 0 ? "text-red" : "text-green"}`}>
          <Glyph name={change < 0 ? "down" : "up"} size={14} />
          {change > 0 ? "+" : ""}
          {change}% vs last month
        </p>
      )}
    </Card>
  );
}
