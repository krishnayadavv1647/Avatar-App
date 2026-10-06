import { useQuery } from "@tanstack/react-query";
import { adminUsersApi } from "@/services/admin.users.api";
import Card from "@/components/common/Card";
import { Badge } from "@/components/forms/controls";
import { Th } from "../parts";
import { date, dateTime } from "../format";

const KIND_LABEL = {
  plan_grant: "Plan credits",
  signup_grant: "Welcome credits",
  admin_grant: "Added by admin",
  admin_deduct: "Removed by admin",
  purchase: "Purchase",
  usage: "Call",
  refund: "Refund",
};

const signed = (n) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;

/**
 * A user's credits on their admin page: the balance and what it buys, what the
 * plan gives each month and when the next grant lands, and the recent ledger.
 * The minutes-used figures elsewhere on the page are real usage and stay as
 * they are; this is what that usage is paid with.
 */
export default function UserCreditsDetail({ userId }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-user-credits", userId],
    queryFn: () => adminUsersApi.credits(userId),
  });

  if (isLoading) return <Card className="mt-4"><p className="text-ui text-text-muted">Loading credits…</p></Card>;
  if (error) return <Card className="mt-4"><p className="text-ui text-red">{error.message}</p></Card>;

  const { rates, equivalents } = data;

  return (
    <>
      <Card title="Credits" className="mt-4">
        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-h2 font-semibold">
              {data.balance.toLocaleString()} <span className="text-ui font-normal text-text-muted">credits</span>
            </p>
            <p className="mt-1 text-ui text-text-faint">
              {data.unlimited
                ? "Unlimited plan: calls never use credits."
                : `${data.available.toLocaleString()} available now${data.available !== data.balance ? " (calls in progress are using some)" : ""}`}
            </p>
            {data.low && <Badge tone="yellow" className="mt-2">Running low</Badge>}
          </div>

          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-ui">
            <dt className="text-text-muted">Plan</dt>
            <dd>{data.plan ? data.plan.name : "None"}</dd>
            <dt className="text-text-muted">Plan credits</dt>
            <dd>
              {!data.plan ? "—" : data.plan.unlimited ? "Unlimited" : `${data.plan.monthlyCredits.toLocaleString()} / month`}
            </dd>
            <dt className="text-text-muted">Next grant</dt>
            <dd>{data.nextGrantAt ? date(data.nextGrantAt) : "—"}</dd>
          </dl>
        </div>

        {!data.unlimited && (
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            {[
              ["standard", "Standard"],
              ["flash", "Flash"],
              ["lite", "Lite"],
            ].map(([key, label]) => (
              <div key={key} className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="text-label text-text-faint">
                  {label} · {rates[key]} credits/min
                </p>
                <p className="mt-1 text-ui font-medium">{equivalents[key].toLocaleString()} min left</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent credit transactions" className="mt-4">
        {data.transactions.length === 0 ? (
          <p className="mt-3 text-ui text-text-muted">No credit activity yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-ui">
              <thead>
                <tr className="text-text-faint">
                  <Th>Kind</Th>
                  <Th>Note</Th>
                  <Th align="right">Credits</Th>
                  <Th align="right">Balance after</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t._id} className="border-t border-border">
                    <td className="py-2.5 pr-4">{KIND_LABEL[t.kind] || t.kind}</td>
                    <td className="max-w-[260px] truncate py-2.5 pr-4 text-text-muted" title={t.note || undefined}>
                      {t.note || "—"}
                    </td>
                    <td className={`py-2.5 text-right tabular-nums ${t.credits > 0 ? "text-green" : ""}`}>{signed(t.credits)}</td>
                    <td className="py-2.5 text-right tabular-nums">{t.balanceAfter?.toLocaleString() ?? "—"}</td>
                    <td className="py-2.5 pl-4 text-text-muted">{dateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.transactions.length && (
              <p className="mt-3 text-label text-text-faint">
                Showing the latest {data.transactions.length} of {data.total.toLocaleString()}.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
