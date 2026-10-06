import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { creditsAdminApi } from "@/services/admin.credits.api";
import { apiUrl } from "@/lib/apiClient";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import { Badge } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";

/**
 * Whether people can pay for credits yet, and what to set up in Stripe if not.
 * The keys themselves are entered under API Keys; this only reads whether they
 * are there, and shows the address Stripe has to send payment events to.
 */
const WEBHOOK_URL = apiUrl("/webhooks/stripe");
// The first two add the credits; the last two only raise a warning in Error Logs, since a refund
// or dispute is for an admin to decide on.
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  "charge.dispute.created",
];

export default function StripeCard() {
  const { data: configs = [] } = useQuery({ queryKey: ["admin-api-configs"], queryFn: creditsAdminApi.apiConfigs });
  const key = configs.find((c) => c.serviceName === "stripe")?.key;
  const secret = configs.find((c) => c.serviceName === "stripe_webhook")?.key;
  const ready = Boolean(key?.hasKey && secret?.hasKey);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };

  return (
    <Card title="Payments (Stripe)" action={<Badge tone={ready ? "green" : "yellow"}>{ready ? "Ready" : "Not set up"}</Badge>}>
      <p className="mt-2 text-ui text-text-muted">
        {ready
          ? "People can buy the active packs below. Credits arrive when Stripe confirms the payment."
          : "Both keys are needed. Until they are saved, people cannot buy credits and the packs are not offered for sale: the secret key takes the payment, and the webhook secret is how we hear it was paid."}
      </p>

      <ul className="mt-4 space-y-2 text-ui">
        <Row label="Secret key" state={key} />
        <Row label="Webhook signing secret" state={secret} />
      </ul>

      <div className="mt-5 rounded-lg border border-border bg-bg p-4">
        <p className="text-ui font-medium">In your Stripe dashboard</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ui text-text-muted">
          <li>
            Developers → Webhooks → Add endpoint, with this address:
            <span className="mt-1 flex items-center gap-2">
              <code className="min-w-0 break-all rounded bg-surface-3 px-2 py-1 text-label text-text">{WEBHOOK_URL}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(WEBHOOK_URL)}>
                Copy
              </Button>
            </span>
          </li>
          <li>Send these events: {EVENTS.map((e) => <code key={e} className="mx-1 rounded bg-surface-3 px-1.5 py-0.5 text-label text-text">{e}</code>)}</li>
          <li>Copy the endpoint's signing secret (starts with whsec_), and your secret key (starts with sk_).</li>
          <li>
            Save both under <Link to="/admin?tab=api_settings" className="text-text underline-offset-2 hover:underline">API Keys</Link>.
          </li>
        </ol>
        <p className="mt-3 text-label text-text-faint">
          Refunds in Stripe do not take credits back by themselves: a refund shows up in Error Logs, and you remove the
          credits from the person's page.
        </p>
      </div>
    </Card>
  );
}

function Row({ label, state }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {state?.hasKey ? (
        <span className="text-text-muted">
          set · ends {state.last4} · from {state.source}
        </span>
      ) : (
        <span className="text-yellow">not set</span>
      )}
    </li>
  );
}
