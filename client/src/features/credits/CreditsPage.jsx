import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creditsApi } from "@/services/credits.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import { Badge } from "@/components/forms/controls";
import { timeAgo } from "@/utils/timeAgo";
import { RENDER_LABEL, formatCredits, formatMinutes, money, useCredits } from "./useCredits";

/**
 * Credits: how many there are, what they buy, how to get more, and where they
 * went. The answer to "how long can I talk?" is the first thing on the page.
 */
const KIND_LABEL = {
  plan_grant: "Monthly credits",
  signup_grant: "Welcome credits",
  admin_grant: "Added by support",
  admin_deduct: "Removed by support",
  purchase: "Purchase",
  usage: "Call",
  refund: "Refund",
};

const date = (value) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function CreditsPage() {
  const [params, setParams] = useSearchParams();
  const purchase = params.get("purchase");
  const queryClient = useQueryClient();

  // Coming back from Stripe the payment may be a moment ahead of the credits, so keep asking.
  const [waiting, setWaiting] = useState(purchase === "success");
  const { data, isLoading, error } = useCredits({ poll: waiting ? 3_000 : 30_000 });

  useEffect(() => {
    if (!waiting) return undefined;
    const stop = setTimeout(() => setWaiting(false), 45_000);
    return () => clearTimeout(stop);
  }, [waiting]);

  const dismiss = () => {
    setWaiting(false);
    setParams({}, { replace: true });
  };

  if (isLoading) return <p className="text-text-muted">Loading credits…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  return (
    <>
      <PageHeader title="Credits" description="Calls are paid for in credits. Here is what you have and what it buys." />

      {purchase === "success" && (
        <Notice tone="good" onDismiss={dismiss}>
          Thank you! {waiting ? "Your credits are being added…" : "If your credits are not here yet, reload in a minute."}
        </Notice>
      )}
      {purchase === "cancelled" && (
        <Notice onDismiss={dismiss}>The purchase was cancelled. You have not been charged.</Notice>
      )}

      <Balance data={data} />
      <Rates data={data} />
      <Packs data={data} onBought={() => queryClient.invalidateQueries({ queryKey: ["credits"] })} />
      <History />
    </>
  );
}

function Notice({ tone, onDismiss, children }) {
  return (
    <div
      role="status"
      className={`mb-4 flex items-center justify-between gap-4 rounded border px-4 py-3 text-ui ${tone === "good" ? "border-green text-green" : "border-border-strong text-text-muted"} bg-surface`}
    >
      <span>{children}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-text-muted hover:text-text">
        ×
      </button>
    </div>
  );
}

function Balance({ data }) {
  const { unlimited, available, equivalents, plan, nextGrantAt, low } = data;

  return (
    <Card>
      <p className="text-ui text-text-muted">Your balance</p>
      {unlimited ? (
        <>
          <p className="mt-2 text-h1 font-semibold">Unlimited</p>
          <p className="mt-1 text-ui text-text-faint">Your {plan?.name} plan has no credit limit, so calls are never refused or charged.</p>
        </>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <p className="text-h1 font-semibold tabular-nums">{formatCredits(available)}</p>
            <p className="text-body text-text-muted">credits</p>
            {low && <Badge tone="yellow">{available <= 0 ? "Out of credits" : "Running low"}</Badge>}
          </div>

          <p className="mt-3 text-ui text-text-muted">That is about</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {Object.entries(equivalents).map(([model, minutes]) => (
              <div key={model} className="rounded-lg border border-border bg-bg px-4 py-3">
                <p className="text-h3 font-semibold tabular-nums">{formatMinutes(minutes)} min</p>
                <p className="text-label text-text-faint">of {RENDER_LABEL[model]} calls</p>
              </div>
            ))}
          </div>

          {plan && (
            <p className="mt-4 text-ui text-text-faint">
              Your {plan.name} plan adds {formatCredits(plan.monthlyCredits)} credits every month
              {nextGrantAt && `, next on ${date(nextGrantAt)}`}. Credits do not expire.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Rates({ data }) {
  if (data.unlimited) return null;
  return (
    <Card title="What a minute costs" className="mt-4">
      <p className="mt-2 text-ui text-text-muted">
        A call is charged for the seconds it actually runs. The price per minute depends on the avatar's render model
        (set on its settings page): the sharper the picture, the more credits a minute takes.
      </p>
      <table className="mt-4 w-full text-ui">
        <thead>
          <tr className="text-left text-text-faint">
            <th className="pb-2 font-normal">Render model</th>
            <th className="pb-2 text-right font-normal">Credits per minute</th>
            <th className="pb-2 text-right font-normal">Minutes you have</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.rates).map(([model, rate]) => (
            <tr key={model} className="border-t border-border">
              <td className="py-2.5">{RENDER_LABEL[model]}</td>
              <td className="py-2.5 text-right tabular-nums">{rate}</td>
              <td className="py-2.5 text-right tabular-nums">{formatMinutes(data.equivalents[model])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Packs({ data, onBought }) {
  const buy = useMutation({
    mutationFn: (packId) => creditsApi.checkout(packId),
    // Stripe hosts the payment page; coming back lands on this page again.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: onBought,
  });

  if (!data.packs.length) return null;

  return (
    <Card title="Get more credits" className="mt-4">
      {!data.purchasable && (
        <p className="mt-3 rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-text-muted">
          Buying credits is not switched on yet. Ask your admin if you need more.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.packs.map((pack) => (
          <div key={pack._id} className="flex flex-col rounded-lg border border-border bg-bg p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-body font-semibold">{pack.name}</p>
              {pack.badge && <Badge tone="purple">{pack.badge}</Badge>}
            </div>
            <p className="mt-3 text-h2 font-semibold tabular-nums">{pack.credits.toLocaleString()}</p>
            <p className="text-label text-text-faint">
              credits · about {formatMinutes(pack.credits / data.rates.standard)} min of Standard
            </p>
            {pack.description && <p className="mt-2 text-ui text-text-muted">{pack.description}</p>}
            <div className="mt-auto pt-4">
              <Button
                fullWidth
                onClick={() => buy.mutate(pack._id)}
                disabled={!data.purchasable || buy.isPending}
              >
                {buy.isPending && buy.variables === pack._id ? "Opening…" : `Buy for ${money(pack.priceCents, pack.currency)}`}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {buy.isError && <p className="mt-3 text-ui text-red">{buy.error.message}</p>}
    </Card>
  );
}

function History() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["credit-transactions", page],
    queryFn: () => creditsApi.transactions(page),
    placeholderData: keepPreviousData,
  });

  return (
    <Card title="History" className="mt-4">
      {isLoading && <p className="mt-3 text-ui text-text-muted">Loading…</p>}
      {error && <p className="mt-3 text-ui text-red">{error.message}</p>}
      {data && data.transactions.length === 0 && <p className="mt-3 text-ui text-text-muted">Nothing yet.</p>}

      {data && data.transactions.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-ui">
            <thead>
              <tr className="text-left text-text-faint">
                <th className="pb-2 font-normal">When</th>
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
                    <p>{KIND_LABEL[t.kind] || t.kind}</p>
                    {t.kind === "usage" && t.meta?.minutes !== undefined ? (
                      <p className="text-label text-text-faint">
                        {formatMinutes(t.meta.minutes)} min at {t.meta.rate} credits a minute
                      </p>
                    ) : (
                      t.note &&
                      t.note !== KIND_LABEL[t.kind] && <p className="text-label text-text-faint">{t.note}</p>
                    )}
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
            Page {data.page} of {data.pages}
          </p>
          <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </div>
      )}
    </Card>
  );
}
