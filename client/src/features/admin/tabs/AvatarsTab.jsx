import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { adminAvatarsApi } from "@/services/admin.avatars.api";
import MediaPreview from "@/components/media/MediaPreview";
import Button from "@/components/common/Button";
import { Badge, Select } from "@/components/forms/controls";
import { timeAgo } from "@/utils/timeAgo";
import ActAsUserDialog from "../users/ActAsUserDialog";
import { useActAsUser } from "../impersonation";

/**
 * Every avatar on the platform, newest first, with who owns it - the admin's
 * view across all users of what the Avatars page shows one workspace at a time.
 *
 * Read-only: an avatar's settings are edited by its owner. The owner line
 * links to that user's page here, where an admin can act on the account.
 */
const STATUSES = ["ready", "training", "draft", "failed"];

export default function AvatarsTab() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [page, setPage] = useState(1);
  const act = useActAsUser();

  // Wait for a pause in typing before asking the server, and start from page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-avatars", { search, status, provider, page }],
    queryFn: () => adminAvatarsApi.list({ q: search, status, provider, page }),
    placeholderData: keepPreviousData,
  });

  const avatars = data?.avatars || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">Avatars{data ? ` (${data.total})` : ""}</h2>
        <p className="text-ui text-text-muted">Every avatar across all users.</p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by avatar or owner…"
          aria-label="Search avatars"
          className="h-10 flex-1 rounded border border-border bg-bg px-3 text-ui text-text outline-none transition-colors placeholder:text-text-faint focus:border-border-strong"
        />
        <div className="lg:w-44">
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            aria-label="Status"
          >
            <option value="">All Status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <div className="lg:w-44">
          <Select
            value={provider}
            onChange={(v) => {
              setProvider(v);
              setPage(1);
            }}
            aria-label="Provider"
          >
            <option value="">All Providers</option>
            {(data?.providers || []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error && <p className="text-red">{error.message}</p>}
      {isLoading && <p className="text-text-muted">Loading avatars…</p>}
      {!isLoading && !error && avatars.length === 0 && (
        <p className="py-8 text-center text-text-muted">No avatars found matching your filters.</p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {avatars.map((avatar) => (
          <AdminAvatarCard key={avatar._id} avatar={avatar} onActAs={act.ask} />
        ))}
      </div>

      <ActAsUserDialog act={act} />

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <p className="text-ui text-text-muted">
            Page {data.page} of {data.pages}
          </p>
          <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** The Avatars page's card, with the owner and numbers where the call buttons would be. */
function AdminAvatarCard({ avatar, onActAs }) {
  const video = useRef(null);

  return (
    <div
      className="group relative aspect-[5/7] overflow-hidden rounded-lg border border-border bg-surface-2"
      onMouseEnter={() => video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (!video.current) return;
        video.current.pause();
        video.current.currentTime = 0;
      }}
    >
      {avatar.previewVideoUrl ? (
        <video
          ref={video}
          src={avatar.previewVideoUrl}
          poster={avatar.previewUrl}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <MediaPreview src={avatar.previewUrl} className="absolute inset-0 h-full w-full object-cover" />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-4 pb-10 pt-3.5">
        <p className="truncate text-body font-semibold text-white">{avatar.name}</p>
        <p className="mt-0.5 text-ui text-white/70">Created {timeAgo(avatar.createdAt)}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone={avatar.status === "ready" ? "ok" : avatar.status === "failed" ? "bad" : "warn"}>
            {avatar.status === "training" ? "Training…" : avatar.status}
          </Chip>
          <Chip>{avatar.providerId}</Chip>
          {avatar.shared && <Chip>Public link</Chip>}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-3 pt-10 text-white">
        <p className="text-label text-white/70">
          {avatar.calls} {avatar.calls === 1 ? "call" : "calls"} · {avatar.minutes} min
        </p>
        {avatar.owner ? (
          <Link
            to={`/admin/users/${avatar.owner._id}`}
            className="mt-1 block truncate text-ui font-medium hover:underline"
            title={avatar.owner.email}
          >
            {avatar.owner.name || avatar.owner.email}
            {avatar.owner.blocked && <span className="ml-2 text-label text-red"> blocked</span>}
          </Link>
        ) : (
          <p className="mt-1 text-ui text-white/60">No owner</p>
        )}
        {avatar.owner?.name && <p className="truncate text-label text-white/60">{avatar.owner.email}</p>}
        {avatar.owner && !avatar.owner.admin && (
          <button
            type="button"
            onClick={() => onActAs({ id: avatar.owner._id, name: avatar.owner.name, email: avatar.owner.email })}
            className="mt-2 rounded-sm border border-white/30 px-2.5 py-1 text-label font-medium text-white transition-colors hover:bg-white/15"
          >
            Act as {avatar.owner.name || "owner"}
          </button>
        )}
        {avatar.failureReason && <Badge tone="red" className="mt-1">{avatar.failureReason}</Badge>}
      </div>
    </div>
  );
}

function Chip({ children, tone }) {
  const color = tone === "ok" ? "text-green" : tone === "bad" ? "text-red" : tone === "warn" ? "text-yellow" : "text-white/80";
  return <span className={`rounded-full bg-black/60 px-2.5 py-0.5 text-label backdrop-blur ${color}`}>{children}</span>;
}
