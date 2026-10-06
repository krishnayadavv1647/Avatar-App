import { useEffect, useRef, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { studioApi } from "@/services/studio.api";
import { Spinner } from "./PromptBar";

/**
 * Preview: the chosen face, large - and, for a photo, actually speaking.
 *
 * - A ready-made face that comes with a talking clip just plays it.
 * - A photo (or a Library face) has no clip, so one is made: the server creates
 *   the avatar as a hidden draft and records a few seconds of it speaking,
 *   which takes about a minute. When it is ready the person keeps it ("Create
 *   avatar" - it simply becomes the avatar, nothing is made twice) or discards
 *   it. Closing the dialog any other way discards it too.
 *
 * `start` begins the draft (the creator knows how for each kind of face);
 * without it the dialog only shows the picture.
 */
const POLL_MS = 4000;
const GIVE_UP_MS = 4 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const discard = (id) => studioApi.preview.discard(id).catch(() => {});

export default function PreviewDialog({ open, item, start, onKept, onClose }) {
  const generate = Boolean(item) && !item.videoUrl && Boolean(start);

  const [phase, setPhase] = useState("starting"); // starting | making | ready | failed
  const [clip, setClip] = useState(null);
  const [error, setError] = useState(null);
  const [keeping, setKeeping] = useState(false);
  const draftId = useRef(null);
  const kept = useRef(false);

  useEffect(() => {
    if (!open || !generate) return undefined;

    let cancelled = false;
    draftId.current = null;
    kept.current = false;
    setPhase("starting");
    setClip(null);
    setError(null);

    (async () => {
      try {
        const { avatarId } = await start();
        draftId.current = avatarId;
        // Closed (or re-opened) while the draft was being made: it is not wanted.
        if (cancelled) return discard(avatarId);

        setPhase("making");
        const began = Date.now();
        while (!cancelled) {
          await sleep(POLL_MS);
          if (cancelled) break;
          const result = await studioApi.preview.status(avatarId);
          if (result.status === "ready") {
            setClip(result.url);
            setPhase("ready");
            return undefined;
          }
          if (result.status === "failed") throw new Error(result.reason || "The preview could not be made.");
          if (Date.now() - began > GIVE_UP_MS) throw new Error("The preview took too long. Try again.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setPhase("failed");
        }
      }
      return undefined;
    })();

    // Whatever ends the dialog, an unkept draft goes with it.
    return () => {
      cancelled = true;
      if (draftId.current && !kept.current) discard(draftId.current);
    };
    // Runs once per opening, for the face that was chosen then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, generate, item?.id]);

  const keep = async () => {
    setKeeping(true);
    setError(null);
    try {
      const avatar = await studioApi.preview.keep(draftId.current);
      kept.current = true;
      onKept(avatar);
    } catch (err) {
      setError(err.message);
    } finally {
      setKeeping(false);
    }
  };

  if (!item) return null;

  const video = generate ? clip : item.videoUrl;
  const making = generate && (phase === "starting" || phase === "making");

  const footer = (
    <div className="flex justify-end gap-2">
      {generate && phase === "ready" ? (
        <>
          <Button variant="ghost" onClick={onClose} disabled={keeping}>
            Discard
          </Button>
          <Button onClick={keep} disabled={keeping}>
            {keeping ? "Creating…" : "Create avatar"}
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={onClose}>
          {making ? "Cancel" : "Close"}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={keeping ? () => {} : onClose}
      title="Preview"
      description={generate ? "See your avatar speak before you create it." : item.label}
      footer={footer}
    >
      <div className="flex flex-col items-center gap-4 px-6 py-5">
        <div className="relative aspect-[2/3] h-[min(58vh,500px)] max-w-full overflow-hidden rounded-lg border border-border-strong bg-surface-3">
          {video ? (
            <video
              key={video}
              src={video}
              poster={item.url}
              autoPlay
              muted
              loop
              playsInline
              controls
              className="h-full w-full object-cover"
            />
          ) : (
            <img
              src={item.url}
              alt={item.label}
              className={`h-full w-full object-cover ${making ? "opacity-40" : ""}`}
            />
          )}

          {making && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner label={phase === "starting" ? "Starting…" : "Making your preview…"} />
            </div>
          )}
        </div>

        {error && <p className="max-w-sm text-center text-ui text-red">{error}</p>}

        {!error && (
          <p className="max-w-sm text-center text-ui text-text-faint">
            {making
              ? "This takes about a minute. The avatar is made for the preview and removed again if you discard it."
              : generate && phase === "ready"
                ? "This is your avatar speaking. Create it to keep it, or discard to try another face."
                : item.videoUrl
                  ? "This is the talking clip the avatar comes with."
                  : "A photo starts to move and speak once the avatar is created."}
          </p>
        )}
      </div>
    </Modal>
  );
}
