import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiKeyApi, connectionApi } from "@/services/apiKey.api";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";

/**
 * "AI tools": connect Claude, ChatGPT, Cursor or another MCP client so it can
 * create and manage avatars on your behalf.
 *
 * Claude.ai and ChatGPT sign in through OAuth (just the address below); tools
 * that read a config file use a key instead. A key is shown once, right after
 * it is made - only a hash is stored.
 */
const MCP_URL = `${window.location.origin}/api/mcp`;
const isLocal = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

export default function ConnectAiTools() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState(null);

  const { data: keys = [], isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: apiKeyApi.list });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["api-keys"] });

  const create = useMutation({
    mutationFn: apiKeyApi.create,
    onSuccess: (key) => {
      setFresh(key);
      setName("");
      refresh();
    },
  });
  const revoke = useMutation({ mutationFn: apiKeyApi.revoke, onSuccess: refresh });

  const { data: connections = [] } = useQuery({ queryKey: ["oauth-connections"], queryFn: connectionApi.list });
  const disconnect = useMutation({
    mutationFn: connectionApi.disconnect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oauth-connections"] }),
  });

  const keyText = fresh?.key || "YOUR_KEY";

  return (
    <>
      <PageHeader
        title="AI tools"
        description="Let Claude, Cursor or any MCP client create and manage your avatars. Just ask it in plain words."
      />

      <Card title="Claude.ai and ChatGPT">
        {isLocal && (
          <p className="mt-3 text-ui text-text-muted">
            This app is running on your own computer, which Claude.ai and ChatGPT cannot reach. Deploy it first, then
            come back to this page on the live address.
          </p>
        )}
        <Step title="Server address">
          <CopyBox text={MCP_URL} />
        </Step>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-ui text-text-muted">
          <li>
            <span className="font-medium text-text">Claude.ai:</span> Settings → Connectors → Add custom connector →
            paste the address → Connect.
          </li>
          <li>
            <span className="font-medium text-text">ChatGPT:</span> Settings → Connectors → Advanced → turn on
            Developer mode → Create → paste the address, choose OAuth → Create.
          </li>
        </ul>
        <p className="mt-3 text-ui text-text-faint">
          You will be sent here to sign in and allow it. Menu names change now and then; look for custom or MCP
          connectors.
        </p>

        {connections.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg">
            {connections.map((c) => (
              <li key={c._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium">{c.name}</p>
                  <p className="text-label text-text-faint">
                    connected {new Date(c.connectedAt).toLocaleDateString()} ·{" "}
                    {c.lastUsedAt ? `used ${new Date(c.lastUsedAt).toLocaleDateString()}` : "not used yet"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => disconnect.mutate(c._id)}
                  disabled={disconnect.isPending && disconnect.variables === c._id}
                  className="h-8 shrink-0 rounded-sm px-3 text-ui text-text-muted transition-colors hover:bg-surface-hover hover:text-red disabled:opacity-40"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Other tools: use a key" className="mt-4">
        <p className="mt-3 text-ui text-text-muted">
          For Claude Code, Claude Desktop and Cursor, which read a config file. Make a key, then paste it into the
          snippet below.
        </p>

        <form
          className="mt-4 flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <div className="flex-1">
            <Field label="Key name" id="key-name" value={name} onChange={setName} placeholder="Claude on my laptop" maxLength={60} />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Making…" : "Make key"}
          </Button>
        </form>
        {create.isError && <p className="mt-3 text-ui text-red">{create.error.message}</p>}

        {fresh && (
          <div className="mt-4 rounded-lg border border-border-strong bg-bg p-4">
            <p className="text-ui font-medium">Copy your key now - it will not be shown again.</p>
            <CopyBox text={fresh.key} />
          </div>
        )}

        {!isLoading && keys.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg">
            {keys.map((k) => (
              <li key={k._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium">{k.name}</p>
                  <p className="text-label text-text-faint">
                    {k.prefix}… · {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke.mutate(k._id)}
                  disabled={revoke.isPending && revoke.variables === k._id}
                  className="h-8 shrink-0 rounded-sm px-3 text-ui text-text-muted transition-colors hover:bg-surface-hover hover:text-red disabled:opacity-40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Paste into your tool" className="mt-4">
        <Step title="Claude Code">
          <CopyBox
            text={`claude mcp add --transport http avatar-studio ${MCP_URL} --header "Authorization: Bearer ${keyText}"`}
          />
        </Step>

        <Step title="Claude Desktop or Cursor" hint="Add this to the tool's MCP config file (needs Node.js).">
          <CopyBox
            text={JSON.stringify(
              {
                mcpServers: {
                  "avatar-studio": {
                    command: "npx",
                    args: ["-y", "mcp-remote", MCP_URL, "--header", "Authorization:${AVATAR_AUTH}"],
                    env: { AVATAR_AUTH: `Bearer ${keyText}` },
                  },
                },
              },
              null,
              2,
            )}
          />
        </Step>

      </Card>

      <Card title="Then ask for things" className="mt-4">
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ui text-text-muted">
          <li>"Create an avatar called Maya with a friendly sales greeting."</li>
          <li>"Make a support avatar from this photo: https://…/portrait.jpg"</li>
          <li>"Change Maya's greeting and switch her voice."</li>
          <li>"Turn on the public link for Maya and give it to me."</li>
          <li>"List my avatars."</li>
        </ul>
        <p className="mt-4 text-ui text-text-faint">
          The assistant acts as you, with your plan's limits. Public links let anyone talk to the avatar, and calls are
          billed to you.
        </p>
      </Card>
    </>
  );
}

function Step({ title, hint, children }) {
  return (
    <div className="mt-5 first:mt-4">
      <p className="text-ui font-medium">{title}</p>
      {hint && <p className="mt-1 text-label text-text-faint">{hint}</p>}
      {children}
    </div>
  );
}

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is selectable, so it can still be copied by hand.
    }
  };

  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 pr-20 text-label text-text-muted">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 h-7 rounded-sm border border-border-strong bg-surface px-3 text-label font-semibold transition-colors hover:bg-surface-3"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
