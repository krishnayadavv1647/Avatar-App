import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { creditsAdminApi } from "@/services/admin.credits.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Field from "@/components/forms/Field";
import { toast } from "@/components/feedback/Toast";
import { RENDER_LABEL } from "@/features/credits/useCredits";

/**
 * What a minute costs, in credits, for each render model - and what a new
 * account with no plan starts with. Changing a rate changes it for calls that
 * start from then on; a call already running keeps the rate it began at.
 */
export default function RatesCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["admin-credit-settings"], queryFn: creditsAdminApi.settings });
  const [rates, setRates] = useState({ standard: "", flash: "", lite: "" });
  const [welcome, setWelcome] = useState("");

  useEffect(() => {
    if (!data) return;
    setRates(Object.fromEntries(data.models.map((m) => [m, String(data.rates[m])])));
    setWelcome(String(data.welcomeCredits));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      creditsAdminApi.saveSettings({
        rates: Object.fromEntries(Object.entries(rates).map(([m, v]) => [m, Number(v)])),
        welcomeCredits: Number(welcome),
      }),
    onSuccess: () => {
      toast.success("Credit settings saved");
      queryClient.invalidateQueries({ queryKey: ["admin-credit-settings"] });
      // What people see - their balance in minutes - follows the rates.
      queryClient.invalidateQueries({ queryKey: ["credits"] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-text-muted">Loading…</p>;
  if (error) return <p className="text-red">{error.message}</p>;

  const valid =
    Object.values(rates).every((v) => Number(v) > 0) && Number.isInteger(Number(welcome)) && Number(welcome) >= 0;
  const changed =
    data.models.some((m) => Number(rates[m]) !== data.rates[m]) || Number(welcome) !== data.welcomeCredits;

  return (
    <Card title="Rates and welcome credits">
      <p className="mt-2 text-ui text-text-muted">
        Credits per minute of conversation, by how the avatar is drawn (its render model). People are shown what their
        credits buy at each.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {data.models.map((model) => {
          const rate = Number(rates[model]);
          return (
            <div key={model}>
              <Field
                label={`${RENDER_LABEL[model]}: credits per minute`}
                id={`rate-${model}`}
                type="number"
                min="0.1"
                step="0.1"
                value={rates[model]}
                onChange={(v) => setRates((r) => ({ ...r, [model]: v }))}
                hint={rate > 0 ? `100 credits = ${Math.floor((100 / rate) * 10) / 10} min` : undefined}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-5 max-w-sm">
        <Field
          label="Welcome credits"
          id="welcome-credits"
          type="number"
          min="0"
          step="1"
          value={welcome}
          onChange={setWelcome}
          hint="Given once to a new account that starts without a plan; it keeps them if it joins a plan later. Zero gives none."
        />
      </div>

      <div className="mt-5 flex gap-2">
        <Button onClick={() => save.mutate()} disabled={!valid || !changed || save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setRates(Object.fromEntries(data.models.map((m) => [m, String(data.defaults[m])])))}
          disabled={save.isPending}
        >
          Use the standard rates
        </Button>
      </div>
    </Card>
  );
}
