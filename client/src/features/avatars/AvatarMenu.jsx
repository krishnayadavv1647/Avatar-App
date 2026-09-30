import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import ShareDialog from "./ShareDialog";

/**
 * The ⋯ menu: share and delete - the actions that are about the avatar rather
 * than its settings. Shared by the avatar page header and the avatar cards, so
 * both ask the same question before deleting.
 *
 * `buttonClassName` styles the trigger for where it sits, `vertical` turns the
 * dots upright (the page header's ⋮ rather than a card's ⋯), and `onDeleted`
 * decides where a deletion leaves the person.
 */
export default function AvatarMenu({ avatar, buttonClassName, vertical = false, onDeleted }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menu = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !menu.current?.contains(e.target) && setOpen(false);
    const escape = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const remove = useMutation({
    mutationFn: () => avatarApi.remove(avatar._id),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      onDeleted?.();
    },
  });

  // The hover clip is recorded in the background (about a minute), so the
  // cards are refreshed a little later to pick it up. LemonSlice agents come
  // with LemonSlice's own clip, so they are not offered one.
  const canMakePreview = avatar.callable && !/^agent_/.test(avatar.providerAvatarId || "");
  const [previewNote, setPreviewNote] = useState(null);
  const makePreview = useMutation({
    mutationFn: () => avatarApi.makePreview(avatar._id),
    onSuccess: () => {
      setPreviewNote("Making the preview video. It shows up on the card in about a minute.");
      for (const ms of [45_000, 90_000]) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["avatars"] });
          queryClient.invalidateQueries({ queryKey: ["avatar", avatar._id] });
        }, ms);
      }
    },
    onError: (err) => setPreviewNote(err.message),
  });

  const item =
    "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-ui transition-colors hover:bg-surface-hover";

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`More actions for ${avatar.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClassName}
      >
        <DotsIcon vertical={vertical} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-44 rounded border border-border-strong bg-surface-2 p-1 text-text shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              setSharing(true);
            }}
          >
            Share &amp; embed
          </button>
          {canMakePreview && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                makePreview.mutate();
              }}
            >
              {avatar.previewVideoUrl ? "Remake preview video" : "Make preview video"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={clsx(item, "text-red")}
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            Delete avatar
          </button>
        </div>
      )}

      {sharing && <ShareDialog avatar={avatar} onClose={() => setSharing(false)} />}

      <Modal
        open={Boolean(previewNote)}
        onClose={() => setPreviewNote(null)}
        title="Preview video"
        description={previewNote}
        footer={<Button onClick={() => setPreviewNote(null)}>OK</Button>}
      />

      <Modal
        open={confirming}
        onClose={() => !remove.isPending && setConfirming(false)}
        title={`Delete ${avatar.name}?`}
        description="Its settings, documents and share link go with it. Past conversations stay in your history."
        footer={
          <>
            {remove.isError && <span className="mr-auto text-ui text-red">{remove.error.message}</span>}
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      />
    </div>
  );
}

function DotsIcon({ vertical }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={vertical ? "rotate-90" : undefined}
    >
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}
