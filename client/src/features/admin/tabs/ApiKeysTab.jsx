import { useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSystemApi } from "@/services/admin.system.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Badge, Label, Switch } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { Glyph, QueryState, TabHeader } from "../system/parts";

const INPUT =
  "h-10 w-full rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong disabled:opacity-40";

const SOURCE_TEXT = {
  database: "Using the key saved here",
  environment: "Using the key from the server's environment",
  none: "No key set",
};

/**
 * API Keys: one card per vendor the app calls, with a key that can be replaced
 * without a redeploy. Keys are write-only: the server reports whether one
 * exists and its last four characters, never the key.
 *
 * Credentials that cannot be swapped under a running server (LiveKit, storage,
 * Stripe) are shown read-only below, as set in the environment.
 */
export default function ApiKeysTab() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["admin-api-configs"],
    queryFn: adminSystemApi.apiConfigs,
  });

  if (!data) return <QueryState isLoading={isLoading} error={error} onRetry={refetch} />;

  const missingRequired = data.configs.filter((c) => c.required && !c.key.hasKey);

  return (
    <div className="space-y-6">
      <TabHeader title="API Configuration" description="Configure the AI services behind avatar calls, voices and storage." />

      {missingRequired.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-line bg-red-dim px-4 py-3">
          <p className="font-semibold text-red">Critical Action Required: Set System API Key</p>
          <p className="mt-1 text-ui text-text-muted">
            Avatar calls are disabled until the {missingRequired.map((c) => c.displayName).join(", ")} key is set. Add it
            in the {missingRequired.length > 1 ? "cards" : "card"} below, or set{" "}
            {missingRequired.map((c) => c.envVar).join(", ")} on the server.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Instructions />
        <Card>
          <h3 className="font-medium">Good to know</h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-ui text-text-muted">
            <li>A key saved here replaces the server's environment variable and takes effect immediately, including for calls already being set up.</li>
            <li>Switching a card off, or removing its key, goes back to the environment variable if there is one.</li>
            <li>Keys are stored encrypted and are never shown again - only the last four characters.</li>
            <li>Test Connection runs from the server with a small read-only request to the vendor.</li>
          </ul>
        </Card>
      </div>

      <div className="grid gap-4">
        {data.configs.map((config) => (
          <ProviderCard key={config.serviceName} config={config} />
        ))}
      </div>

      <section>
        <h3 className="mb-1 text-h3">Set in environment</h3>
        <p className="mb-4 text-ui text-text-muted">
          These cannot be changed while the server runs, so they are read-only here. Change them where the server is
          deployed and restart it.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {data.environment.map((group) => (
            <EnvironmentCard key={group.id} group={group} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Instructions() {
  return (
    <Card>
      <h3 className="font-medium">LemonSlice setup</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-ui text-text-muted">
        <li>
          Visit{" "}
          <a href="https://lemonslice.com" target="_blank" rel="noopener noreferrer" className="text-text underline">
            lemonslice.com
          </a>{" "}
          and create an account.
        </li>
        <li>Open the API section of your dashboard and create an API key.</li>
        <li>Paste it into the LemonSlice card below and save.</li>
        <li>Make sure the Active switch is on, then use Test Connection.</li>
      </ol>
      <div className="mt-4 rounded-lg border border-red-line bg-red-dim px-3 py-2.5">
        <p className="text-ui font-medium text-red">Critical: LemonSlice is required</p>
        <p className="mt-0.5 text-label text-text-muted">
          Without its key no avatar call can start - people see an error instead of an avatar.
        </p>
      </div>
    </Card>
  );
}

function ProviderCard({ config }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-api-configs"] });

  const save = useMutation({
    mutationFn: (patch) => adminSystemApi.updateApiConfig(config.serviceName, patch),
    onSuccess: (_, patch) => {
      if ("apiKey" in patch) setKey("");
      if ("clearKey" in patch) setConfirmRemove(false);
      toast.success(
        "isActive" in patch && Object.keys(patch).length === 1
          ? `${config.displayName} ${patch.isActive ? "activated" : "deactivated"}`
          : "API configuration saved",
      );
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const test = useMutation({
    mutationFn: () => adminSystemApi.testApiConfig(config.serviceName),
    onSuccess: (result) => {
      // valid -> success; a vendor quirk -> info; anything else is a problem to act on.
      const show = result.outcome === "valid" ? toast.success : result.outcome === "warning" ? toast.info : toast.error;
      show(result.message, { duration: 8000 });
      refresh();
    },
    onError: (err) => toast.error("Test Failed", { description: err.message }),
  });

  const baseChanged = baseUrl.trim() !== config.baseUrl;
  const dirty = key.trim() !== "" || baseChanged;

  const submit = () => {
    const patch = {};
    if (key.trim()) patch.apiKey = key.trim();
    if (baseChanged) patch.baseUrl = baseUrl.trim();
    save.mutate(patch);
  };

  const { usageStats: stats } = config;

  return (
    <Card className={clsx(config.required && "border-red-line")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-h3">
            {config.displayName}
            {config.required && <Badge tone="red">REQUIRED</Badge>}
            {config.needsRestart && <Badge tone="orange">Needs restart</Badge>}
          </p>
          <p className="mt-1 text-ui text-text-muted">{config.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={config.isActive}
            onChange={(isActive) => save.mutate({ isActive })}
            label={`${config.displayName} active`}
            disabled={save.isPending}
          />
          <Badge tone={config.isActive ? "green" : "neutral"}>{config.isActive ? "Active" : "Inactive"}</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`key-${config.serviceName}`}>API Key</Label>
          <input
            id={`key-${config.serviceName}`}
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={config.key.hasKey ? `Saved - ends in ${config.key.last4}. Type to replace.` : `Enter your ${config.displayName} API key`}
            className={INPUT}
          />
          <p className="mt-1.5 text-label text-text-faint">
            {SOURCE_TEXT[config.key.source]}
            {config.key.hasKey && ` (ends in ${config.key.last4})`}. {config.envVar} sets it outside the panel.
            {config.key.storedInDatabase && !config.isActive && " A saved key is ignored while this is inactive."}
          </p>
        </div>
        <div>
          <Label htmlFor={`url-${config.serviceName}`}>Base URL</Label>
          <input
            id={`url-${config.serviceName}`}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={config.baseUrl}
            className={INPUT}
          />
          <p className="mt-1.5 text-label text-text-faint">Where Test Connection reaches the vendor.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-ui text-text-muted">
          <span>Requests:</span> {stats.totalRequests} | <span className="text-green">Success:</span> {stats.successfulRequests} |{" "}
          <span className="text-red">Failed:</span> {stats.failedRequests}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={submit} disabled={!dirty || save.isPending}>
            <Glyph name="save" size={14} />
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {config.key.storedInDatabase && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={save.isPending}>
              Remove key
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={!config.key.hasKey || test.isPending}>
            <Glyph name="test" size={14} />
            {test.isPending ? "Testing…" : "Test Connection"}
          </Button>
          {config.documentation && (
            <Button as="a" size="sm" variant="secondary" href={config.documentation} target="_blank" rel="noopener noreferrer">
              Documentation
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove the ${config.displayName} key?`}
        message="The saved key will be deleted. The server goes back to its environment variable, if one is set."
        confirmLabel="Remove key"
        busy={save.isPending}
        onConfirm={() => save.mutate({ clearKey: true })}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  );
}

function EnvironmentCard({ group }) {
  const isStorage = group.id === "storage";

  const test = useMutation({
    mutationFn: adminSystemApi.testStorage,
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error("Storage Connection Test Failed", { description: r.message })),
    onError: (err) => toast.error("Storage Connection Test Failed", { description: err.message }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{group.name}</h3>
        <Badge tone={group.configured ? "green" : "neutral"}>{group.configured ? "Configured" : "Not configured"}</Badge>
      </div>
      <p className="mt-1 text-label text-text-muted">{group.description}</p>
      <dl className="mt-3 space-y-1.5 text-ui">
        {group.items.map((item) => (
          <div key={item.envVar} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 truncate">
              <span className="text-text-muted">{item.label}</span>{" "}
              <code className="text-label text-text-faint">{item.envVar}</code>
            </dt>
            <dd className={clsx("shrink-0 tabular-nums", item.configured ? "text-text" : "text-text-faint")}>
              {item.configured ? item.preview : "not set"}
            </dd>
          </div>
        ))}
      </dl>
      {isStorage && (
        <Button size="sm" variant="secondary" className="mt-4" onClick={() => test.mutate()} disabled={test.isPending}>
          <Glyph name="test" size={14} />
          {test.isPending ? "Testing…" : "Test Storage Connection"}
        </Button>
      )}
    </Card>
  );
}
