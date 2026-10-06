import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { creditsAdminApi } from "@/services/admin.credits.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import { Select } from "@/components/forms/controls";
import { formatCredits } from "@/features/credits/useCredits";
import { timeAgo } from "@/utils/timeAgo";

const KINDS = [
  ["plan_grant", "Monthly credits"],
  ["signup_grant", "Welcome credits"],
  ["admin_grant", "Added by an admin"],
  ["admin_deduct", "Removed by an admin"],
  ["purchase", "Purchases"],
  ["usage", "Calls"],
  ["refund", "Refunds"],
];
const LABEL = Object.fromEntries(KINDS);

/** Every credit movement on the platform, newest first. */
export default function LedgerCard() {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-credit-ledger", { kind, search, page }],
    queryFn: () => creditsAdminApi.transactions({ kind, q: search, page }),
    placeholderData: keepPreviousData,
  });

  return (
    <Card title="Ledger">
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by person…"
          aria-label="Search the ledger"
          className="h-10 flex-1 rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
        />
        <div className="sm:w-52">
          <Select
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            aria-label="Kind"
          >
            <option value="">Everything</option>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading && <p className="mt-4 text-ui text-text-muted">Loading…</p>}
      {error && <p className="mt-4 text-ui text-red">{error.message}</p>}
      {data && data.transactions.length === 0 && <p className="mt-4 text-ui text-text-muted">Nothing found.</p>}

      {data && data.transactions.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="text-left text-text-faint">
                <th className="pb-2 font-normal">When</th>
                <th className="pb-2 font-normal">Who</th>
                <th className="pb-2 font-normal">What</th>
                <th className="pb-2 text-right font-normal">Credits</th>
                <th className="pb-2 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t._id} className="border-t border-border">
                  <td className="py-2.5 text-text-muted" title={new Date(t.createdAt).toLocaleString()}>
                    {timeAgo(t.createdAt)}
                  </td>
                  <td className="py-2.5">
                    {t.user ? (
                      <Link to={`/admin/users/${t.user._id}`} className="hover:underline" title={t.user.email}>
                        {t.user.name || t.user.email}
                      </Link>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <p>{LABEL[t.kind] || t.kind}</p>
                    {t.note && t.kind !== "usage" && <p className="text-label text-text-faint">{t.note}</p>}
                  </td>
                  <td className={`py-2.5 text-right tabular-nums ${t.credits > 0 ? "text-green" : ""}`}>
                    {t.credits > 0 ? "+" : "−"}
                    {formatCredits(Math.abs(t.credits))}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-text-muted">
                    {t.balanceAfter === undefined ? "" : formatCredits(t.balanceAfter)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <p className="text-ui text-text-muted">
            Page {data.page} of {data.pages} · {data.total.toLocaleString()} entries
          </p>
          <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </Card>
  );
}
