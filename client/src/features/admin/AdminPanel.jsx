import { Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/services/admin.api";
import { useAuth } from "@/store/auth.store";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import AdminGate from "./AdminGate";
import AdminNav from "./AdminNav";
import Icon from "./icons";
import { Stat } from "./parts";
import { compact } from "./format";
import { DEFAULT_TAB, TABS } from "./tabs";

/**
 * The Master Admin Panel: four headline figures, a dropdown nav, and one tab's
 * screen at a time. The open tab lives in the address (?tab=plans) so a
 * refresh, a shared link or the back button all land where you were.
 *
 * Tabs' queries are keyed "admin-...", which is what Refresh reloads.
 */
export default function AdminPanel() {
  return (
    <AdminGate>
      <Panel />
    </AdminGate>
  );
}

const isAdminQuery = { predicate: (query) => String(query.queryKey[0]).startsWith("admin") };

function Panel() {
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const fetching = useIsFetching(isAdminQuery) > 0;

  const requested = search.get("tab");
  const active = TABS.find((t) => t.value === requested) || TABS.find((t) => t.value === DEFAULT_TAB);
  const ActiveTab = active.component;

  const { data: stats } = useQuery({ queryKey: ["admin-stats"], queryFn: adminApi.stats, refetchInterval: 30_000 });

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>Master Admin Panel</h1>
          <p className="mt-1.5 text-text-muted">Manage users, plans, and system settings</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => queryClient.invalidateQueries(isAdminQuery)} disabled={fetching}>
            <Icon name="refresh" size={14} className={fetching ? "mr-2 animate-spin" : "mr-2"} />
            Refresh
          </Button>
          <span className="text-ui text-text-muted">Welcome, {user?.name || user?.email || "admin"}</span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total Users" value={stats ? compact(stats.totalUsers) : "—"} />
        <Stat label="Active Users" value={stats ? compact(stats.activeUsers) : "—"} detail="Not blocked" />
        <Stat label="Pending Invites" value={stats ? compact(stats.pendingInvites) : "—"} />
        <Stat label="Total Minutes Used" value={stats ? compact(stats.totalMinutes) : "—"} detail="All calls, all time" />
      </div>

      <div className="mt-6">
        <AdminNav activeTab={active.value} onChange={(tab) => setSearch({ tab }, { replace: true })} />
      </div>

      <Card className="mt-4 p-4 md:p-6">
        <Suspense fallback={<p className="text-text-muted">Loading…</p>}>
          <ActiveTab />
        </Suspense>
      </Card>
    </>
  );
}
