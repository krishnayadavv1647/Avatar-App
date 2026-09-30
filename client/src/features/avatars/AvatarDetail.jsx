import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import { studioApi } from "@/services/studio.api";
import Panel from "@/components/layout/Panel";
import AvatarSettings from "./AvatarSettings";
import AvatarChat from "./AvatarChat";
import AvatarBuild from "./AvatarBuild";
import AvatarMenu from "./AvatarMenu";
import { useAutosave } from "./useAutosave";

/**
 * One avatar: talk to it, or change how it looks, sounds and behaves.
 *
 * Laid out like LemonSlice's agent page - a rounded panel with the name and an
 * edit pencil on the left, Chat / Settings on the right, and the avatar's ⋯
 * menu (AvatarMenu) beside them. Creating an avatar lands here, on Settings.
 *
 * Settings save themselves as they change (see useAutosave), so there is no
 * Save button; the header says when a save is in flight or has failed.
 */
const TABS = [
  { id: "chat", label: "Chat", icon: ChatIcon },
  { id: "settings", label: "Settings", icon: SlidersIcon },
  { id: "build", label: "Build", icon: GlobeIcon },
];

export default function AvatarDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = ["chat", "build"].includes(params.get("tab")) ? params.get("tab") : "settings";

  const { data: avatar, isLoading, error } = useQuery({
    queryKey: ["avatar", id],
    queryFn: () => avatarApi.get(id),
  });
  const { data: options } = useQuery({ queryKey: ["studio-options"], queryFn: studioApi.options });
  const autosave = useAutosave(id);

  if (isLoading) return <Panel><p className="p-8 text-text-muted">Loading avatar…</p></Panel>;
  if (error || !avatar) {
    return (
      <Panel>
        <p className="p-8 text-text-muted">{error?.message || "Avatar not found"}</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <Header
        avatar={avatar}
        tab={tab}
        onTab={(next) => setParams(next === "settings" ? {} : { tab: next }, { replace: true })}
        autosave={autosave}
      />
      {tab === "chat" ? (
        <AvatarChat avatar={avatar} />
      ) : tab === "build" ? (
        <AvatarBuild avatar={avatar} />
      ) : (
        // Keyed so a different avatar starts from its own values, not the last one's.
        <AvatarSettings key={avatar._id} avatar={avatar} options={options} onChange={autosave.queue} />
      )}
    </Panel>
  );
}

function Header({ avatar, tab, onTab, autosave }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 rounded-t-xl bg-surface/90 px-6 py-5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/avatars")}
          aria-label="Back to avatars"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeftIcon />
        </button>
        <EditableName name={avatar.name} onRename={(name) => autosave.queue({ name }, { now: true })} />
      </div>

      <div className="flex items-center gap-3">
        <SaveStatus status={autosave.status} error={autosave.error} />
        <div role="tablist" className="flex gap-1 rounded-lg border border-border bg-bg p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className={clsx(
                "flex h-9 items-center gap-2 rounded-sm border px-4 text-ui font-medium transition-colors",
                tab === id
                  ? "border-border-strong bg-surface-2 text-text"
                  : "border-transparent text-text-muted hover:text-text",
              )}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
        <AvatarMenu
          avatar={avatar}
          vertical
          onDeleted={() => navigate("/avatars")}
          buttonClassName="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-bg text-text-muted transition-colors hover:text-text"
        />
      </div>
    </header>
  );
}

/** The name with a pencil; the pencil turns it into an input until Enter or blur. */
function EditableName({ name, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);

  // Follows the saved name, but only when it actually changes - so a rename
  // shows at once instead of flicking back until the save lands.
  useEffect(() => setValue(name), [name]);

  // Enter and Escape both just blur, so the rename is committed exactly once.
  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setValue(name);
      return;
    }
    const next = value.trim();
    if (next && next !== name) onRename(next);
    else setValue(name);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={80}
        aria-label="Avatar name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancelled.current = true;
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
        className="h-9 min-w-0 rounded-sm border border-border-strong bg-bg px-2 text-h3 font-medium text-text outline-none"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="truncate text-h3 font-medium">{value}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Rename avatar"
        title="Rename"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <PencilIcon />
      </button>
    </div>
  );
}

function SaveStatus({ status, error }) {
  if (status === "idle") return null;
  const text = {
    saving: "Saving…",
    saved: "Saved",
    error: `Couldn't save${error?.message ? `: ${error.message}` : ""}`,
  }[status];
  return (
    <span
      role="status"
      className={clsx("max-w-[240px] truncate text-ui", status === "error" ? "text-red" : "text-text-faint")}
      title={text}
    >
      {text}
    </span>
  );
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

function ChevronLeftIcon() {
  return (
    <svg {...stroke}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...stroke} width={15} height={15}>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...stroke}>
      <path d="M8 2.5c3.3 0 5.5 2.1 5.5 4.8S11.3 12 8 12c-.8 0-1.6-.1-2.3-.4L2.5 13l.9-2.6C2.8 9.5 2.5 8.4 2.5 7.3 2.5 4.6 4.7 2.5 8 2.5z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg {...stroke}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M2.25 8h11.5M8 2.25c1.6 1.6 2.3 3.6 2.3 5.75S9.6 12.15 8 13.75C6.4 12.15 5.7 10.15 5.7 8S6.4 3.85 8 2.25z" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </svg>
  );
}

