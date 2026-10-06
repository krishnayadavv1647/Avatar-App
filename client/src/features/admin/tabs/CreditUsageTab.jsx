import { useEffect, useState } from "react";
import clsx from "clsx";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSystemApi } from "@/services/admin.system.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Segmented from "@/components/forms/Segmented";
import { Badge, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import Icon from "../icons";
import { QueryState, TabHeader } from "../system/parts";

const PERIODS = [
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const TABS = [
  { value: "avatar", label: "By avatar" },
  { value: "provider", label: "By provider" },
  { value: "user", label: "By user" },
  { value: "rules", label: "Cost rules" },
];

/** Cents as dollars, with a sign when asked (for the difference). */
const dollars = (cents, signed = false) => {
  const text = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  if (!signed) return cents < 0 ? `-${text}` : text;
  return cents < 0 ? `-${text}` : cents > 0 ? `+${text}` : text;
};
const num = (n) => Math.round(n * 100) / 100;

/**
 * Credit Usage: minutes used against what the avatar vendors cost.
 *
 * "Estimated" is what the app recorded for each call, from the planning rate.
 * "Actual provider cost" re-prices the same minutes at the $/min the admin
 * entered under Cost rules. "Difference" is estimated minus actual: green when
 * the estimate covers the real cost, red when it falls short. Until a rule is
 * changed both use the same rate, so the difference reads $0.00.
 */
export default function CreditUsageTab() {
  const [days, setDays] = useState("30");
  const [tab, setTab] = useState("avatar");

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-credit-usage", days],
    queryFn: () => adminSystemApi.creditUsage(Number(days)),
    // Switching period keeps the old figures on screen, dimmed, instead of a blank flash.
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <TabHeader title="Credit Usage" description="Minutes billed to users vs what the providers really cost.">
        <div className="w-40">
          <Select value={days} onChange={setDays} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" onClick={() => refetch()} aria-label="Refresh" disabled={isFetching} className="!px-3">
          <Icon name="refresh" className={clsx(isFetching && "animate-spin")} />
        </Button>
      </TabHeader>

      {!data ? (
        <QueryState isLoading={isLoading} error={error} onRetry={refetch} />
      ) : (
        <div className={clsx("space-y-4 transition-opacity", isFetching && "opacity-60")}>
          <Totals totals={data.totals} />

          <Segmented value={tab} onChange={setTab} options={TABS} />

          {tab === "avatar" && <UsageTable groups={data.byAvatar} label="Avatar" />}
          {tab === "provider" && <UsageTable groups={data.byProvider} label="Provider" />}
          {tab === "user" && <UsageTable groups={data.byUser} label="User" />}
          {tab === "rules" && <CostRules rules={data.rules} />}
        </div>
      )}
    </div>
  );
}

function Totals({ totals }) {
  const short = totals.differenceCents < 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Figure label="Calls" value={totals.uses} />
      <Figure label="Minutes" value={num(totals.minutes)} />
      <Figure label="Estimated cost" value={dollars(totals.estimatedCents)} />
      <Figure label="Actual provider cost" value={dollars(totals.actualCents)} />
      <Figure
        label="Difference"
        value={dollars(totals.differenceCents, true)}
        tone={short ? "text-red" : "text-green"}
        hint="Estimated minus actual"
      />
    </div>
  );
}

function Figure({ label, value, tone = "", hint }) {
  return (
    <Card>
      <p className="text-label uppercase tracking-wider text-text-muted">{label}</p>
      <p className={clsx("mt-1 text-h2 font-semibold", tone)}>{value}</p>
      {hint && <p className="mt-1 text-label text-text-faint">{hint}</p>}
    </Card>
  );
}

function UsageTable({ groups, label }) {
  if (!groups.length) return <p className="py-6 text-center text-ui text-text-muted">No usage in this period.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-ui">
        <thead className="bg-surface-3 text-text">
          <tr>
            <th className="p-2.5 text-left font-medium">{label}</th>
            <th className="p-2.5 text-right font-medium">Uses</th>
            <th className="p-2.5 text-right font-medium">Minutes</th>
            <th className="p-2.5 text-right font-medium">Estimated</th>
            <th className="p-2.5 text-right font-medium">Actual</th>
            <th className="p-2.5 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-border">
              <td className="max-w-[280px] truncate p-2.5" title={g.label}>
                {g.label}
              </td>
              <td className="p-2.5 text-right tabular-nums">{g.uses}</td>
              <td className="p-2.5 text-right tabular-nums">{num(g.minutes)}</td>
              <td className="p-2.5 text-right font-medium tabular-nums">{dollars(g.estimatedCents)}</td>
              <td className="p-2.5 text-right tabular-nums">{dollars(g.actualCents)}</td>
              <td className={clsx("p-2.5 text-right font-medium tabular-nums", g.differenceCents < 0 ? "text-red" : "text-green")}>
                {dollars(g.differenceCents, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One $/min input per known provider - used or not - starting from the planning
 * figure. Only entries the admin changed (or already had saved) are stored, so
 * leaving a default alone keeps following it; clearing a box returns to it.
 */
function CostRules({ rules }) {
  const queryClient = useQueryClient();
  const initial = () => Object.fromEntries(rules.map((r) => [r.providerId, String(r.rate)]));
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial()), [rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const r of rules) {
        const text = (draft[r.providerId] ?? "").trim();
        if (text === "" || Number.isNaN(Number(text))) continue;
        if (r.custom || Number(text) !== r.defaultRate) payload[r.providerId] = Number(text);
      }
      return adminSystemApi.saveCostRules(payload);
    },
    onSuccess: () => {
      toast.success("Cost rules saved");
      queryClient.invalidateQueries({ queryKey: ["admin-credit-usage"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-label text-text-muted">
        Enter what one minute really costs at each provider, in US dollars. Clear a box to go back to the planning
        figure from the provider matrix.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rules.map((r) => (
          <label key={r.providerId} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 truncate text-ui" title={r.providerId}>
                {r.providerId}
                {r.developmentOnly && <Badge tone="outline">dev stub</Badge>}
              </span>
              <span className="block text-label text-text-faint">default ${r.defaultRate}/min</span>
            </span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={draft[r.providerId] ?? ""}
              onChange={(e) => setDraft({ ...draft, [r.providerId]: e.target.value })}
              aria-label={`${r.providerId} dollars per minute`}
              className="h-8 w-24 rounded border border-border bg-bg px-2 text-right text-ui tabular-nums text-text outline-none focus:border-border-strong"
            />
          </label>
        ))}
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save cost rules"}
      </Button>
    </div>
  );
}
