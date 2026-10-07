import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionApi } from "@/services/apiKey.api";
import { apiUrl } from "@/lib/apiClient";
import Card from "@/components/common/Card";
import Button from "@/components/common/Button";

/**
 * "AI tools": connect Claude, ChatGPT, Cursor or another MCP client so it can
 * create and manage avatars on your behalf.
 *
 * Claude.ai and ChatGPT sign in through OAuth with just the address below.
 */
const MCP_URL = apiUrl("/mcp");
const isLocal = /^(localhost|127\.|\[::1\])/.test(new URL(MCP_URL).hostname);

export default function ConnectAiTools() {
  const queryClient = useQueryClient();

  const { data: connections = [] } = useQuery({ queryKey: ["oauth-connections"], queryFn: connectionApi.list });
  const disconnect = useMutation({
    mutationFn: connectionApi.disconnect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["oauth-connections"] }),
  });

  return (
    <>
      <div className="space-y-8">
        <header className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-label font-bold uppercase tracking-wider text-text-muted">
            <SparkIcon /> AI Connection
          </span>
          <h1>Connect your AI to Avatar Studio</h1>
          <p className="max-w-2xl text-text-muted">
            Link your own AI assistant to the studio and manage your avatars by chat — create avatars, change
            greetings and voices, and turn on public links. The assistant signs in as you and can only touch your own
            work.
          </p>
          {isLocal && (
            <p className="max-w-2xl text-ui text-text-muted">
              This app is running on your own computer, which Claude.ai and ChatGPT cannot reach. Deploy it first, then
              come back to this page on the live address.
            </p>
          )}
        </header>


        <ServerUrlBox url={MCP_URL} />

        <div className="grid gap-4 md:grid-cols-2">
          <ClientCard
            icon={<BotIcon />}
            title="Claude"
            subtitle="Desktop and web"
            steps={[
              "Open your profile menu and go to Settings → Connectors.",
              'Choose "Add custom connector".',
              "Name it Avatar Studio and paste the connection URL.",
              "Press Add, then sign in and approve when the studio's consent page opens.",
            ]}
          />
          <ClientCard
            icon={<ChatIcon />}
            title="ChatGPT"
            subtitle="Developer mode required"
            steps={[
              "Go to Apps and enable Developer mode — ChatGPT will warn you that connectors in developer mode are unverified and can act on your data, so only add servers you trust.",
              'Choose "Create app".',
              "Name it Avatar Studio, paste the connection URL and press Create.",
              "Enable the app from the chat composer, then sign in and approve on the consent page.",
            ]}
          />
          <ClientCard
            icon={<CodeIcon />}
            title="Cursor"
            subtitle="Editor integration"
            steps={[
              "Open Settings → Tools & Integrations.",
              'Choose "New MCP Server" — this opens mcp.json.',
              "Add an entry whose url is the connection URL above, then save.",
              "Toggle the server on, then sign in and approve on the consent page.",
            ]}
          />
          <ClientCard
            icon={<PlugGlyph />}
            title="Any other client"
            subtitle="Custom MCP setup"
            steps={[
              "Copy the connection URL above.",
              "Add it as a streamable HTTP MCP server — a name and the URL is all most clients need.",
              "Reload the client so it picks up the new server.",
              "Sign in and approve on the consent page when prompted.",
            ]}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <ShieldGlyph />
              <h3 className="text-ui font-semibold">It acts as you, nothing more</h3>
            </div>
            <p className="text-label leading-relaxed text-text-muted">
              You sign in with your own studio account and approve the connection once. Your assistant then works
              inside exactly the same permissions, plan and credits you have in the app — it can see and change your
              avatars, and no one else's.
            </p>
          </Card>
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <RefreshGlyph />
              <h3 className="text-ui font-semibold">Refresh after studio updates</h3>
            </div>
            <p className="text-label leading-relaxed text-text-muted">
              Assistants cache the list of things they can do. When we ship new studio features, refresh or reconnect
              the connector in your client — you may be asked to approve access again, which is normal.
            </p>
          </Card>
        </div>
      </div>

      {connections.length > 0 && (
        <Card title="Connected apps" className="mt-4">
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
        </Card>
      )}
    </>
  );
}

/** The app's own MCP address, read-only, with a copy button. */
function ServerUrlBox({ url }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the field is selectable, so it can still be copied by hand.
    }
  };

  return (
    <Card>
      <p className="mb-2 text-label font-bold uppercase tracking-wider text-text-faint">Your connection URL</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-ui text-text"
        />
        <Button type="button" onClick={copy} className="h-11 shrink-0 px-5">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2.5 text-label text-text-muted">
        Paste this into your AI assistant. Every client below uses the same address.
      </p>
    </Card>
  );
}

/** One AI client's setup path, as a numbered list. */
function ClientCard({ icon, title, subtitle, steps }) {
  return (
    <Card>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-body font-semibold leading-tight text-text">{title}</h3>
          <p className="mt-0.5 text-label text-text-muted">{subtitle}</p>
        </div>
      </div>
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-ui leading-relaxed text-text">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-label font-bold">
              {i + 1}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* Inline so this page carries no icon dependency for a handful of glyphs. */
const stroke = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "shrink-0",
};

const SparkIcon = () => (
  <svg {...stroke} width={12} height={12}>
    <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4z" />
  </svg>
);
const BotIcon = () => (
  <svg {...stroke}>
    <rect x="2.5" y="5" width="11" height="8" rx="2" />
    <path d="M8 2.5V5M5.5 8.5v1M10.5 8.5v1" />
  </svg>
);
const ChatIcon = () => (
  <svg {...stroke}>
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
  </svg>
);
const CodeIcon = () => (
  <svg {...stroke}>
    <path d="m5.5 4.5-3 3.5 3 3.5M10.5 4.5l3 3.5-3 3.5" />
  </svg>
);
const PlugGlyph = () => (
  <svg {...stroke}>
    <path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5zM8 12v2" />
  </svg>
);
const ShieldGlyph = () => (
  <svg {...stroke}>
    <path d="M8 2 3 4v4c0 3 2 5 5 6 3-1 5-3 5-6V4z" />
    <path d="m6 8 1.5 1.5L10 6.5" />
  </svg>
);
const RefreshGlyph = () => (
  <svg {...stroke}>
    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
  </svg>
);
