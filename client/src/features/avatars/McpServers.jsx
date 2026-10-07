import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import Button from "@/components/common/Button";
import Field from "@/components/forms/Field";

/**
 * The MCP row: external tool servers the avatar can use during calls.
 *
 * Like the Knowledge Base this does not wait for Save - adding a server is its own
 * request, and the server connects to it first, so a wrong URL or token comes
 * back as an error here instead of a silent failure on a call.
 */
const EMPTY = { name: "", url: "", authToken: "" };

export default function McpServers({ avatarId }) {
  const queryClient = useQueryClient();
  const key = ["avatar-mcp-servers", avatarId];
  const [form, setForm] = useState(null);

  const { data: servers = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => avatarApi.mcpServers(avatarId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (body) => avatarApi.addMcpServer(avatarId, body),
    onSuccess: () => {
      setForm(null);
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => avatarApi.setMcpServerEnabled(avatarId, id, enabled),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id) => avatarApi.removeMcpServer(avatarId, id),
    onSuccess: refresh,
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const canSubmit = form && form.name.trim() && form.url.trim() && !add.isPending;

  return (
    <div className="border-t border-border px-6 py-5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-body font-medium">MCP servers</p>
          <p className="mt-1 text-ui text-text-muted">
            Connect tools your avatar can use during a call, like a calendar, CRM or database.
          </p>
        </div>
        {!form && (
          <button
            type="button"
            onClick={() => {
              add.reset();
              setForm(EMPTY);
            }}
            className="h-9 shrink-0 rounded-sm border border-border-strong bg-bg px-4 text-ui font-semibold text-text transition-colors hover:bg-surface-3"
          >
            Connect server
          </button>
        )}
      </div>

      {form && (
        <form
          className="mt-4 rounded-lg border border-border bg-bg p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            add.mutate({
              name: form.name.trim(),
              url: form.url.trim(),
              ...(form.authToken.trim() && { authToken: form.authToken.trim() }),
            });
          }}
        >
          <Field label="Name" id="mcp-name" value={form.name} onChange={(name) => set({ name })} placeholder="Calendar" maxLength={40} />
          <Field
            label="Server URL"
            id="mcp-url"
            value={form.url}
            onChange={(url) => set({ url })}
            placeholder="https://example.com/mcp"
            hint="A remote MCP server (streamable HTTP or SSE)."
          />
          <Field
            label="Auth token (optional)"
            id="mcp-token"
            type="password"
            autoComplete="off"
            value={form.authToken}
            onChange={(authToken) => set({ authToken })}
            hint="Sent as a Bearer token. Stored encrypted and never shown again."
          />
          {add.isError && <p className="mt-3 text-ui text-red">{add.error.message}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setForm(null)} disabled={add.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {add.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      )}

      {toggle.isError && <p className="mt-3 text-ui text-red">{toggle.error.message}</p>}
      {remove.isError && <p className="mt-3 text-ui text-red">{remove.error.message}</p>}

      {!isLoading && servers.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg">
          {servers.map((s) => (
            <li key={s._id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui font-medium" title={s.url}>
                  {s.name}
                </p>
                <p className="truncate text-label text-text-faint" title={s.toolNames.join(", ")}>
                  {s.toolNames.length} {s.toolNames.length === 1 ? "tool" : "tools"}
                  {s.toolNames.length > 0 && ` · ${s.toolNames.slice(0, 4).join(", ")}${s.toolNames.length > 4 ? "…" : ""}`}
                </p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-label text-text-muted">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => toggle.mutate({ id: s._id, enabled: e.target.checked })}
                />
                On
              </label>
              <button
                type="button"
                onClick={() => remove.mutate(s._id)}
                disabled={remove.isPending && remove.variables === s._id}
                aria-label={`Remove ${s.name}`}
                title="Remove"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-red disabled:opacity-40"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
