import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";

/**
 * The Knowledge Base row: documents the avatar can draw on during calls.
 *
 * Unlike the rest of the settings this does not go through autosave - an
 * upload is its own request, and the list is whatever the server now holds.
 * Only text is kept; the server reads PDF, DOCX, TXT and MD.
 */
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

export default function KnowledgeBase({ avatarId, onBrief }) {
  const queryClient = useQueryClient();
  const fileInput = useRef(null);
  const key = ["avatar-documents", avatarId];

  const { data: documents = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => avatarApi.documents(avatarId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (file) => avatarApi.addDocument(avatarId, file),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (docId) => avatarApi.removeDocument(avatarId, docId),
    onSuccess: refresh,
  });

  const [site, setSite] = useState(null); // null: closed; otherwise the form's state
  const learn = useMutation({
    mutationFn: ({ url, applyBrief }) => avatarApi.learnWebsite(avatarId, { url, applyBrief }),
    onSuccess: (result) => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["avatar", avatarId] });
      if (result.brief) onBrief?.(result.brief);
      setSite(null);
    },
  });

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-body font-medium">Knowledge Base</p>
          <p className="mt-1 text-ui text-text-muted">
            Add documents, or a website, to provide context to your avatar.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setSite(site ? null : { url: "", applyBrief: true })}
            disabled={learn.isPending}
            aria-expanded={Boolean(site)}
            className="h-9 rounded-sm border border-border-strong bg-bg px-4 text-ui font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            Add website
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={add.isPending}
            className="h-9 rounded-sm border border-border-strong bg-bg px-4 text-ui font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            {add.isPending ? "Reading…" : "Add document"}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) add.mutate(file);
            // Cleared so choosing the same file again still fires a change.
            e.target.value = "";
          }}
        />
      </div>

      {site && (
        <form
          className="mt-4 space-y-3 rounded-lg border border-border bg-bg p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (site.url.trim() && !learn.isPending) learn.mutate(site);
          }}
        >
          <label className="block">
            <span className="text-ui font-medium">Website or business link</span>
            <input
              type="text"
              inputMode="url"
              autoFocus
              value={site.url}
              onChange={(e) => setSite({ ...site, url: e.target.value })}
              disabled={learn.isPending}
              placeholder="https://yourbusiness.com"
              className="mt-1.5 h-10 w-full rounded-sm border border-border-strong bg-surface px-3 text-ui outline-none focus:border-text disabled:opacity-60"
            />
          </label>
          <label className="flex items-start gap-2 text-ui text-text-muted">
            <input
              type="checkbox"
              checked={site.applyBrief}
              onChange={(e) => setSite({ ...site, applyBrief: e.target.checked })}
              disabled={learn.isPending}
              className="mt-0.5"
            />
            <span>
              Also write the avatar&apos;s instructions and greeting from this site. This replaces the current ones.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={learn.isPending || !site.url.trim()}
              className="h-9 rounded-sm bg-text px-4 text-ui font-semibold text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {learn.isPending ? "Reading the website…" : "Train from website"}
            </button>
            {learn.isPending && (
              <span role="status" className="text-label text-text-faint">
                This can take up to a minute.
              </span>
            )}
          </div>
          {learn.isError && <p className="text-ui text-red">{learn.error.message}</p>}
          <p className="text-label text-text-faint">
            Reads the page you give plus a few related pages (about, services, pricing, contact). Pages that need
            sign-in or only load with JavaScript cannot be read.
          </p>
        </form>
      )}

      {add.isError && <p className="mt-3 text-ui text-red">{add.error.message}</p>}
      {remove.isError && <p className="mt-3 text-ui text-red">{remove.error.message}</p>}

      {!isLoading && documents.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-bg">
          {documents.map((doc) => (
            <li key={doc._id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-text-muted">
                <DocIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui font-medium" title={doc.name}>
                  {doc.name}
                </p>
                <p className="text-label text-text-faint">
                  {formatBytes(doc.bytes)} · {doc.chars.toLocaleString()} characters
                  {doc.truncated && " · only the first part is used"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(doc._id)}
                disabled={remove.isPending && remove.variables === doc._id}
                aria-label={`Remove ${doc.name}`}
                title="Remove"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-red disabled:opacity-40"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && documents.length === 0 && (
        <p className="mt-3 text-label text-text-faint">PDF, DOCX, TXT or MD · up to 10 MB each</p>
      )}
    </div>
  );
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
};

function DocIcon() {
  return (
    <svg {...stroke}>
      <path d="M9 1.5H4.5a1.5 1.5 0 0 0-1.5 1.5v10a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.5z" />
      <path d="M9 1.5v4h4M5.5 8.5h5M5.5 11h3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...stroke} width={14} height={14}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
