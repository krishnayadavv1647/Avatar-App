import { useEffect, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { avatarApi } from "@/services/avatar.api";
import { studioApi } from "@/services/studio.api";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";

/**
 * "Edit avatar visuals": a new face for an avatar - an uploaded photo or one
 * of the Library faces. Everything else about the avatar (name, brief, voice,
 * share link, history) stays as it is. The hover clip is remade on the server
 * for the new face and turns up on the card a minute or so later.
 */
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export default function EditVisualsDialog({ avatar, onClose }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("upload"); // upload | library
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [faceId, setFaceId] = useState(null);
  const [gender, setGender] = useState(avatar.gender === "male" ? "male" : "female");
  const [fileError, setFileError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const { data: stock, isLoading } = useQuery({ queryKey: ["studio-stock"], queryFn: studioApi.stock });
  const faces = (stock || []).filter((a) => a.providerId === "library" && a.gender === gender);

  // A local preview of the chosen file, released when it changes.
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (f) => {
    setFileError(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setFileError("Use a JPG, PNG or WEBP image.");
    if (f.size > MAX_BYTES) return setFileError("Keep the image under 10 MB.");
    setFile(f);
  };

  const save = useMutation({
    mutationFn: () =>
      avatarApi.replaceVisuals(avatar._id, mode === "upload" ? { file } : { faceId }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["avatar", avatar._id], updated);
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      // The new hover clip is made in the background; pick it up when it lands.
      for (const ms of [45_000, 90_000]) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["avatar", avatar._id] });
          queryClient.invalidateQueries({ queryKey: ["avatars"] });
        }, ms);
      }
      onClose();
    },
  });

  const ready = mode === "upload" ? Boolean(file) : Boolean(faceId);

  return (
    <Modal
      open
      onClose={() => !save.isPending && onClose()}
      title="Edit avatar visuals"
      description="Give this avatar a new face. Its name, brief, voice and conversations stay the same."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!ready || save.isPending}>
            {save.isPending ? "Saving…" : "Save new face"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Tabs
          value={mode}
          onChange={setMode}
          disabled={save.isPending}
          options={[
            ["upload", "Upload photo"],
            ["library", "Library"],
          ]}
        />

        {mode === "upload" ? (
          <div>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
              className={clsx(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
                dragging ? "border-pink bg-pink-dim" : "border-border-strong bg-surface-2 hover:bg-surface-3",
              )}
            >
              {preview ? (
                <img src={preview} alt="" className="h-40 rounded-lg object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-text-muted">
                  <UploadIcon />
                </span>
              )}
              <span className="text-ui font-medium">
                {file ? file.name : "Drop a photo here, or click to choose"}
              </span>
              <span className="text-label text-text-faint">
                A clear, front-facing face works best · JPG, PNG or WEBP · up to 10 MB
              </span>
              <input
                type="file"
                accept={TYPES.join(",")}
                className="sr-only"
                disabled={save.isPending}
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </label>
            {fileError && <p className="mt-2 text-ui text-red">{fileError}</p>}
          </div>
        ) : (
          <div>
            <Tabs
              value={gender}
              onChange={(g) => {
                setGender(g);
                setFaceId(null);
              }}
              disabled={save.isPending}
              options={[
                ["female", "Female"],
                ["male", "Male"],
              ]}
            />
            {isLoading && <p className="mt-3 text-ui text-text-faint">Loading faces…</p>}
            {!isLoading && faces.length === 0 && (
              <p className="mt-3 text-ui text-text-faint">No Library faces are available on this server.</p>
            )}
            <div className="mt-3 grid max-h-[46vh] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
              {faces.map((f) => {
                const active = f.providerAvatarId === faceId;
                return (
                  <button
                    key={f.providerAvatarId}
                    type="button"
                    disabled={save.isPending}
                    onClick={() => setFaceId(f.providerAvatarId)}
                    aria-label={f.name}
                    aria-pressed={active}
                    title={f.name}
                    className={clsx(
                      "relative aspect-square overflow-hidden rounded-sm border-2 transition-colors",
                      active ? "border-pink" : "border-transparent hover:border-border-strong",
                    )}
                  >
                    <img src={f.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-label text-text-faint">
          The hover video is remade for the new face; it shows up on the card in about a minute.
        </p>

        {save.error && <p className="text-ui text-red">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

function Tabs({ value, onChange, options, disabled }) {
  return (
    <div className="flex gap-1 rounded border border-border-strong bg-bg p-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          disabled={disabled}
          onClick={() => onChange(id)}
          className={clsx(
            "h-8 flex-1 rounded-sm px-3 text-ui font-medium transition-colors disabled:opacity-50",
            value === id ? "bg-surface-3 text-text" : "text-text-muted hover:text-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
