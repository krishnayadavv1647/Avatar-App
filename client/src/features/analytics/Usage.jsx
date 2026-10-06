import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/services/analytics.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import { formatCredits } from "@/features/credits/useCredits";

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Usage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage"],
    queryFn: analyticsApi.usage,
  });

  if (isLoading) return <p className="text-text-muted">Loading usage…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  return (
    <>
      <PageHeader
        title="Usage"
        description={`Since ${new Date(data.periodStart).toLocaleDateString()}`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Minutes" value={data.totals.minutes.toFixed(1)} />
        <Stat label="Estimated cost" value={money(data.totals.costCents)} />
        <Stat
          label="Active now"
          value={String(data.activeCalls)}
          tone={data.activeCalls > 0 ? "live" : undefined}
        />
      </div>

      <Card title="By provider" className="mt-4">
        {data.byProvider.length === 0 ? (
          <p className="mt-4 text-ui text-text-muted">No calls yet this period.</p>
        ) : (
          <table className="mt-4 w-full text-ui">
            <thead>
              <tr className="text-text-faint">
                <th className="pb-2 text-left font-normal">Provider</th>
                <th className="pb-2 text-right font-normal">Calls</th>
                <th className="pb-2 text-right font-normal">Minutes</th>
                <th className="pb-2 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.byProvider.map((row) => (
                <tr key={row.providerId} className="border-t border-border">
                  <td className="py-2.5">{row.providerId}</td>
                  <td className="py-2.5 text-right font-mono">{row.calls}</td>
                  <td className="py-2.5 text-right font-mono">{row.minutes.toFixed(1)}</td>
                  <td className="py-2.5 text-right font-mono">{money(row.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data.credits && (
        <p className="mt-5 text-ui text-text-faint">
          {data.credits.plan && `Plan ${data.credits.plan.name} · `}
          {data.credits.unlimited ? "unlimited credits" : `${formatCredits(data.credits.available)} credits left`}
          {" · "}
          <Link to="/credits" className="text-text-muted underline-offset-2 hover:text-text hover:underline">
            Manage credits
          </Link>
        </p>
      )}

      <p className="mt-2 text-ui text-text-faint">
        Cost is estimated from observed call duration, not billed by the vendor.
      </p>
    </>
  );
}

function Stat({ label, value, tone }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-ui text-text-muted">{label}</p>
        {tone === "live" && (
          <span className="rounded-full bg-green-dim px-2.5 py-1 text-label text-green">Live</span>
        )}
      </div>
      <p className="mt-2 text-h1 font-medium">{value}</p>
    </Card>
  );
}
