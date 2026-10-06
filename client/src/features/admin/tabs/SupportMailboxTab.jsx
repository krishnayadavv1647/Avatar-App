import { useMemo, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commsApi } from "@/services/admin.comms.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { TextArea } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import { useSiteConfig } from "@/hooks/useBranding";
import Icon from "../icons";
import SupportComposeDialog from "../comms/SupportComposeDialog";
import { SafeHtml, SearchBox } from "../comms/shared";

const FILTERS = ["all", "unread", "replied", "archived"];

const fmt = (value, options) => (value ? new Date(value).toLocaleString("en-US", options) : "");
const short = (v) => fmt(v, { month: "short", day: "numeric" });
const long = (v) => fmt(v, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).replace(/(\d{4}),/, "$1 at");
const stamp = (v) => fmt(v, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The support inbox: a list on the left, the open conversation on the right.
 * Messages arrive through the inbound email webhook; replies go out through
 * the same mail provider and are kept in the thread.
 */
export default function SupportMailboxTab() {
  const queryClient = useQueryClient();
  const { data: config } = useSiteConfig();
  const supportAddress = config?.support_email;

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [reply, setReply] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const key = ["admin-support"];
  const { data: emails = [], isLoading, isFetching, refetch, isError } = useQuery({ queryKey: key, queryFn: commsApi.supportEmails });

  // Writes the new status into the cached list straight away, so the row updates without waiting for a refetch.
  const patchLocal = (id, patch) =>
    queryClient.setQueryData(key, (rows = []) => rows.map((e) => (e._id === id ? { ...e, ...patch } : e)));

  const selected = emails.find((e) => e._id === selectedId) || null;

  const open = (email) => {
    setSelectedId(email._id);
    setReply("");
    if (email.status === "unread" && email.direction === "inbound") {
      patchLocal(email._id, { status: "read" });
      commsApi.setSupportStatus(email._id, "read").catch(() => patchLocal(email._id, { status: "unread" }));
    }
  };

  const send = useMutation({
    mutationFn: () => commsApi.replySupport(selected._id, reply),
    onSuccess: async () => {
      toast.success("Reply sent");
      setReply("");
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(`Failed to send: ${err.message}`),
  });

  const archive = useMutation({
    mutationFn: (email) => commsApi.setSupportStatus(email._id, "archived"),
    onSuccess: (_, email) => {
      patchLocal(email._id, { status: "archived" });
      toast.success("Archived");
    },
    onError: () => toast.error("Archive failed"),
  });

  const remove = useMutation({
    mutationFn: (email) => commsApi.deleteSupportEmail(email._id),
    onSuccess: (_, email) => {
      queryClient.setQueryData(key, (rows = []) => rows.filter((e) => e._id !== email._id));
      if (selectedId === email._id) setSelectedId(null);
      toast.success("Deleted");
    },
    onError: () => toast.error("Delete failed"),
    onSettled: () => setDeleting(null),
  });

  // The inbox lists inbound mail only; outbound copies appear inside a conversation.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return emails.filter((e) => {
      if (e.direction !== "inbound") return false;
      if (filter === "all" ? e.status === "archived" : e.status !== filter) return false;
      return !q || [e.fromEmail, e.subject, e.textBody].some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [emails, filter, search]);

  const unread = emails.filter((e) => e.status === "unread" && e.direction === "inbound").length;

  const thread = useMemo(() => {
    if (!selected) return [];
    const same = selected.threadId ? emails.filter((e) => e.threadId === selected.threadId) : [selected];
    return same.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
  }, [emails, selected]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-h2">
            <Icon name="inbox" size={22} className="text-text-muted" />
            Support Mailbox
            {unread > 0 && <span className="rounded-full bg-pink px-2.5 py-0.5 text-label font-medium text-text-inverse">{unread} unread</span>}
          </h2>
          <p className="mt-1 text-ui text-text-muted">
            {supportAddress ? (
              <>
                Emails received at <span className="text-pink">{supportAddress}</span>
              </>
            ) : (
              "Emails received at your support address"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            Compose
          </Button>
          <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
            <Icon name="refresh" size={14} className={clsx("mr-2", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={clsx(
              "rounded-md border px-3 py-1.5 text-label font-medium transition-colors",
              filter === f ? "border-pink bg-pink-dim text-text" : "border-border text-text-muted hover:text-text",
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <SearchBox value={search} onChange={setSearch} placeholder="Search emails..." />
      </div>

      {isError && <p className="text-ui text-red">Failed to load support emails</p>}

      <div className="grid min-h-[600px] gap-4 lg:grid-cols-[380px_1fr]">
        {/* List */}
        <Card flush className={clsx(selected && "hidden lg:block")}>
          <div className="h-[600px] overflow-y-auto">
            {isLoading ? (
              <p className="p-6 text-center text-ui text-text-muted">Loading...</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-ui text-text-muted">
                <Icon name="inbox" size={40} className="mx-auto mb-3 opacity-40" />
                No emails found
              </div>
            ) : (
              filtered.map((e) => (
                <button
                  key={e._id}
                  type="button"
                  onClick={() => open(e)}
                  className={clsx(
                    "block w-full border-b border-border p-3 text-left transition-colors hover:bg-surface-hover",
                    selectedId === e._id && "bg-pink-dim",
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className={clsx("truncate text-ui", e.status === "unread" ? "font-bold text-text" : "text-text-muted")}>{e.fromName || e.fromEmail}</span>
                    <span className="shrink-0 text-[10px] text-text-faint">{short(e.receivedAt)}</span>
                  </div>
                  <div className={clsx("truncate text-label", e.status === "unread" ? "font-semibold text-text" : "text-text-muted")}>{e.subject}</div>
                  <div className="mt-0.5 truncate text-label text-text-faint">{(e.textBody || "").substring(0, 80)}</div>
                  <div className="mt-1 flex gap-1">
                    {e.status === "unread" && <span className="rounded-full bg-pink px-1.5 text-[9px] font-medium text-text-inverse">New</span>}
                    {e.status === "replied" && <span className="rounded-full bg-green-dim px-1.5 text-[9px] font-medium text-green">Replied</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Conversation */}
        <Card flush className={clsx(!selected && "hidden lg:block")}>
          {!selected ? (
            <div className="flex h-[600px] items-center justify-center text-ui text-text-muted">
              <div className="text-center">
                <Icon name="mail" size={48} className="mx-auto mb-3 opacity-40" />
                Select an email to view
              </div>
            </div>
          ) : (
            <div className="flex h-[600px] flex-col">
              <div className="border-b border-border p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setSelectedId(null)} aria-label="Back to the list" className="text-text-muted hover:text-text lg:hidden">
                    ‹
                  </button>
                  <h3 className="flex-1 text-h3 font-semibold">{selected.subject}</h3>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate(selected)} disabled={selected.status === "archived"} title="Archive">
                      Archive
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red" onClick={() => setDeleting(selected)} title="Delete">
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="space-y-0.5 text-label text-text-muted">
                  <div>
                    <span className="text-text">From:</span> {selected.fromName ? `${selected.fromName} <${selected.fromEmail}>` : selected.fromEmail}
                  </div>
                  <div>
                    <span className="text-text">To:</span> {selected.toEmail}
                  </div>
                  <div>
                    <span className="text-text">Received:</span> {long(selected.receivedAt)}
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {thread.map((m) => (
                  <div
                    key={m._id}
                    className={clsx(
                      "rounded-lg border p-3",
                      m.direction === "outbound" ? "ml-6 border-pink bg-pink-dim" : "mr-6 border-border bg-surface-2",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between text-[10px] text-text-faint">
                      <span className="font-medium">{m.direction === "outbound" ? "You replied" : m.fromName || m.fromEmail}</span>
                      <span>{stamp(m.receivedAt)}</span>
                    </div>
                    {m.htmlBody ? <SafeHtml html={m.htmlBody} /> : <div className="whitespace-pre-wrap text-ui">{m.textBody}</div>}
                    {m.attachments?.length > 0 && (
                      <div className="mt-2 border-t border-border pt-2">
                        <div className="mb-1 text-[10px] text-text-faint">Attachments:</div>
                        {m.attachments.map((a, i) => (
                          <a key={i} href={/^https?:\/\//i.test(a.url) ? a.url : undefined} target="_blank" rel="noopener noreferrer" className="block text-label text-pink hover:underline">
                            📎 {a.filename}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selected.direction === "inbound" && (
                <div className="border-t border-border bg-bg p-3">
                  <TextArea value={reply} onChange={setReply} rows={3} placeholder={`Reply to ${selected.fromEmail}...`} className="mb-2" />
                  <div className="flex justify-end">
                    <Button onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>
                      {send.isPending ? "Sending..." : "Send Reply"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <SupportComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} onSent={() => queryClient.invalidateQueries({ queryKey: key })} from={supportAddress} />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete email"
        message="Delete this email permanently?"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
