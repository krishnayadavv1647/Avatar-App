import { useEffect, useState } from "react";
import clsx from "clsx";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminSystemApi } from "@/services/admin.system.api";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import Modal from "@/components/common/Modal";
import { Badge, Select } from "@/components/forms/controls";
import { toast } from "@/components/feedback/Toast";
import Icon from "../icons";
import { Glyph, QueryState } from "../system/parts";

const SEVERITY_TONE = { CRITICAL: "red", ERROR: "orange", WARNING: "yellow", INFO: "blue" };
const STATUS_TEXT = { NEW: "New", ACKNOWLEDGED: "Acknowledged", RESOLVED: "Resolved" };
const PAGE_SIZE = 25;

// "Oct 6, 01:23:45 PM"
const rowTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});
const formatTime = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Invalid Date" : rowTime.format(d);
};
const formatLong = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
};

/**
 * Error Logs: what went wrong on the server, searchable and sortable, with a
 * workflow for working through it - acknowledge, resolve, delete, and clear what
 * is already resolved. Search, filters, sort and paging all run on the server.
 */
export default function ErrorLogsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState({ key: "timestamp", dir: "desc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "one", log } | { kind: "resolved" }

  // Searches once typing pauses, and from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-error-logs", q, severity, status, sort.key, sort.dir, page],
    queryFn: () => adminSystemApi.errorLogs({ q, severity, status, sort: sort.key, dir: sort.dir, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-error-logs"] });

  const setLogStatus = useMutation({
    mutationFn: ({ id, status: next }) => adminSystemApi.setErrorLogStatus(id, next),
    onSuccess: (_, { id, status: next }) => {
      setSelected((s) => (s && s.id === id ? { ...s, status: next } : s));
      toast.success(`Marked as ${STATUS_TEXT[next].toLowerCase()}`);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (log) => adminSystemApi.removeErrorLog(log.id),
    onSuccess: () => {
      toast.success("Error log deleted");
      setConfirm(null);
      setSelected(null);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const clearResolved = useMutation({
    mutationFn: adminSystemApi.clearResolvedErrorLogs,
    onSuccess: ({ deleted }) => {
      toast.success(deleted ? `Cleared ${deleted} resolved ${deleted === 1 ? "log" : "logs"}` : "No resolved logs to clear");
      setConfirm(null);
      setPage(1);
      refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const sortBy = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const arrow = (key) => (sort.key === key ? <Glyph name={sort.dir === "asc" ? "up" : "down"} size={12} className="ml-1" /> : null);

  const filtered = Boolean(q || severity || status);
  const from = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const resolvedCount = data?.counts.RESOLVED || 0;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-h3">
              <Glyph name="alert" size={20} className="text-red" />
              Application Error Logs
            </h2>
            <p className="mt-1 text-ui text-text-muted">
              Monitor and debug system-wide errors.
              {data && ` ${data.counts.NEW} new, ${data.counts.ACKNOWLEDGED} acknowledged.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Glyph name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search logs..."
                aria-label="Search logs"
                className="h-10 w-60 rounded border border-border bg-bg pl-9 pr-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
              />
            </div>
            <div className="w-36">
              <Select value={severity} onChange={(v) => { setSeverity(v); setPage(1); }} aria-label="Filter by severity">
                <option value="">All severities</option>
                {Object.keys(SEVERITY_TONE).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} aria-label="Filter by status">
                <option value="">All statuses</option>
                {Object.entries(STATUS_TEXT).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh" className="!px-3">
              <Icon name="refresh" className={clsx(isFetching && "animate-spin")} />
            </Button>
            <Button variant="ghost" onClick={() => setConfirm({ kind: "resolved" })} disabled={resolvedCount === 0}>
              Clear resolved{resolvedCount ? ` (${resolvedCount})` : ""}
            </Button>
          </div>
        </div>

        {!data ? (
          <div className="mt-4">
            <QueryState isLoading={isLoading} error={error} onRetry={refetch} loading="Loading logs…" />
          </div>
        ) : (
          <div className={clsx("mt-4 transition-opacity", isFetching && "opacity-60")}>
            {error && <p className="mb-3 text-ui text-red">{error.message}</p>}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-ui">
                <thead className="text-text-faint">
                  <tr className="border-b border-border">
                    <SortableTh onClick={() => sortBy("timestamp")}>Timestamp{arrow("timestamp")}</SortableTh>
                    <SortableTh onClick={() => sortBy("severity")}>Severity{arrow("severity")}</SortableTh>
                    <th className="px-3 py-2.5 text-left font-normal">Error</th>
                    <th className="px-3 py-2.5 text-left font-normal">Function</th>
                    <th className="px-3 py-2.5 text-left font-normal">User</th>
                    <th className="px-3 py-2.5 text-right font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="h-24 text-center text-text-muted">
                        No error logs found.
                      </td>
                    </tr>
                  ) : (
                    data.logs.map((log) => (
                      <tr key={log.id} className={clsx("border-t border-border hover:bg-surface-hover", log.status === "RESOLVED" && "opacity-60")}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-text-muted">{formatTime(log.timestamp)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={SEVERITY_TONE[log.severity] || "orange"}>{log.severity || "ERROR"}</Badge>
                          <p className="mt-1 text-label text-text-faint">{STATUS_TEXT[log.status]}</p>
                        </td>
                        <td className="max-w-xs px-3 py-2.5">
                          <p className="truncate" title={log.message}>
                            {log.message || "No message"}
                          </p>
                          <p className="truncate text-label text-text-faint">{log.errorType}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone="neutral">{log.functionName || "N/A"}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-text-muted">{log.userEmail || "N/A"}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Button size="sm" variant="secondary" onClick={() => setSelected(log)}>
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {data.total > 0 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-ui text-text-muted">
                <span>
                  {from}–{to} of {data.total.toLocaleString()}
                  {filtered && " matching"}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.message || "No message"}
        description={
          selected && (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONE[selected.severity] || "orange"}>{selected.severity || "ERROR"}</Badge>
              <span>
                Error occurred in <strong>{selected.functionName || "N/A"}</strong> at {formatLong(selected.timestamp)}
              </span>
            </span>
          )
        }
        footer={
          selected && (
            <>
              <Button variant="ghost" onClick={() => setConfirm({ kind: "one", log: selected })}>
                Delete
              </Button>
              {selected.status === "NEW" && (
                <Button variant="secondary" disabled={setLogStatus.isPending} onClick={() => setLogStatus.mutate({ id: selected.id, status: "ACKNOWLEDGED" })}>
                  Acknowledge
                </Button>
              )}
              {selected.status !== "RESOLVED" ? (
                <Button disabled={setLogStatus.isPending} onClick={() => setLogStatus.mutate({ id: selected.id, status: "RESOLVED" })}>
                  Resolve
                </Button>
              ) : (
                <Button variant="secondary" disabled={setLogStatus.isPending} onClick={() => setLogStatus.mutate({ id: selected.id, status: "NEW" })}>
                  Reopen
                </Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-ui sm:grid-cols-4">
              <Meta label="Type" value={selected.errorType} />
              <Meta label="Status" value={STATUS_TEXT[selected.status]} />
              <Meta label="User" value={selected.userEmail || "N/A"} />
              <Meta
                label="Related"
                value={selected.relatedEntityType ? `${selected.relatedEntityType} ${selected.relatedEntityId || ""}`.trim() : "None"}
              />
            </dl>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border bg-bg p-4">
              <pre className="whitespace-pre-wrap font-mono text-label text-text-muted">
                {JSON.stringify(selected.details || {}, null, 2)}
              </pre>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm?.kind === "one"}
        title="Delete this error log?"
        message="It is removed for good."
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(confirm.log)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "resolved"}
        title="Clear resolved logs?"
        message={`${resolvedCount} resolved ${resolvedCount === 1 ? "log is" : "logs are"} removed for good. New and acknowledged logs are kept.`}
        confirmLabel="Clear resolved"
        busy={clearResolved.isPending}
        onConfirm={() => clearResolved.mutate()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

function SortableTh({ children, onClick }) {
  return (
    <th className="px-3 py-2.5 text-left font-normal">
      <button type="button" onClick={onClick} className="inline-flex items-center transition-colors hover:text-text">
        {children}
      </button>
    </th>
  );
}

function Meta({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-text-faint">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
