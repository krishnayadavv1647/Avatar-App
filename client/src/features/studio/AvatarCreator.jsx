import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioApi } from "@/services/studio.api";
import { PRESETS, briefFromPreset } from "./presets";
import { useCustomVoices } from "@/features/avatars/CustomVoices";
import CropDialog from "./CropDialog";
import EnhanceDialog from "./EnhanceDialog";
import GenerateDialog from "./GenerateDialog";
import EditImageDialog from "./EditImageDialog";
import PreviewDialog from "./PreviewDialog";
import ToolMenu from "./ToolMenu";
import { canvasToFile, editError, loadImage, transformImage } from "./imageTools";

/**
 * The avatar creator: a full-window page, not a dialog.
 *
 * The face is the subject, so it gets the middle of the screen at full height;
 * the right panel only picks the character - Female or Male, then a face from
 * the library - with the create action pinned to its foot. Everything about how
 * it behaves is set afterwards, on the avatar's settings page, which is where
 * creating lands. Rendered without the app shell for the same reason as the
 * call room - the picture wants the whole window.
 *
 * The library holds photos added this visit, then every vendor's ready-made
 * avatars (for LemonSlice, the agents on the account behind the API key). The
 * toggle filters it: a photo takes the gender it was added under, and a
 * ready-made face is tagged once, here, and shows under both until it is.
 *
 * A dashboard template arrives as `?template=<id>` and becomes the starting
 * brief, sent silently with the create.
 *
 * The tools under the face edit it in the browser: Enhance, Crop, rotate and
 * flip (in the ... menu) each produce a new picture, and an edited picture is
 * simply an uploaded photo - which is what the server takes on create. A
 * library face can be edited too (it becomes a photo); a vendor's own avatar
 * cannot, because it is an agent on their side, not a picture. Preview shows
 * the face large, playing its clip when it has one.
 *
 * The wand opens "Generate image" (describe a face, the image service makes it)
 * and "Edit image" (describe a change to the current face). Colour and
 * brightness adjustments live in the ... menu.
 */

const SOON = "Coming soon";

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

export default function AvatarCreator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const preset = PRESETS.find((p) => p.id === params.get("template"));
  const fileInput = useRef(null);

  // Every photo added this visit, newest first; the selected one is the face.
  const [uploads, setUploads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [gender, setGender] = useState("female");
  // One of the workspace's own (cloned) voices, or "" for the usual voice.
  const [ownVoice, setOwnVoice] = useState("");
  const { data: customVoices = [] } = useCustomVoices();

  const { data: options } = useQuery({ queryKey: ["studio-options"], queryFn: studioApi.options });
  const limits = options?.limits.photo;

  // Checked up front: without a vendor the upload would succeed and the create
  // would then be refused, after the person had set everything up.
  const noVendor = options && !options.providers.some((p) => p.photoAvatar && p.usable);

  const { data: stock, isLoading: stockLoading, error: stockError } = useQuery({
    queryKey: ["studio-stock"],
    queryFn: studioApi.stock,
  });
  const templates = (stock || []).map((a) => ({
    id: `${a.providerId}:${a.providerAvatarId}`,
    kind: "stock",
    providerId: a.providerId,
    providerAvatarId: a.providerAvatarId,
    url: a.previewUrl,
    videoUrl: a.previewVideoUrl,
    label: a.name,
    gender: a.gender,
  }));

  const library = [...uploads, ...templates].filter((item) => !item.gender || item.gender === gender);
  const selected = library.find((item) => item.id === selectedId);
  const fromStock = selected?.kind === "stock";

  // Something is always on the canvas when the library has anything to show,
  // the way the vendor's own creator never opens empty - including after the
  // toggle hides the face that was selected.
  const firstVisible = library[0]?.id ?? null;
  useEffect(() => {
    if (!selected && firstVisible) setSelectedId(firstVisible);
  }, [selected, firstVisible]);

  // Object URLs are revoked when the page goes, not when a photo is deselected:
  // it stays in the library and can be picked again.
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const tag = useMutation({
    mutationFn: (value) =>
      studioApi.setStockGender({
        providerId: selected.providerId,
        providerAvatarId: selected.providerAvatarId,
        gender: value,
      }),
    onSuccess: (_, value) => {
      // Follow the face to its tab rather than letting it vanish from this one.
      setGender(value);
      queryClient.invalidateQueries({ queryKey: ["studio-stock"] });
    },
  });

  // Only a template's own brief is sent; a ready-made face otherwise keeps the
  // settings its vendor already has, and everything else is edited afterwards.
  // A chosen clone rides along with it.
  const brief = preset ? briefFromPreset(preset) : undefined;
  const behaviour = ownVoice ? { ...brief, voice: ownVoice } : brief;

  const create = useMutation({
    mutationFn: () =>
      fromStock
        ? studioApi.createFromStock({
            providerId: selected.providerId,
            providerAvatarId: selected.providerAvatarId,
            gender,
            behaviour,
          })
        : studioApi.createFromPhoto({ file: selected.file, name: "Untitled avatar", gender, behaviour }),
    onSuccess: (avatar) => {
      queryClient.invalidateQueries({ queryKey: ["avatars"] });
      navigate(`/avatars/${avatar._id}`);
    },
  });
  const busy = create.isPending;

  const add = (chosen) => {
    if (!chosen) return;
    if (limits && !limits.types.includes(chosen.type)) {
      setFileError(`That file type is not supported. Use ${formatTypes(limits.types)}.`);
      return;
    }
    if (limits && chosen.size > limits.maxBytes) {
      setFileError(`That image is ${mb(chosen.size)}. The limit is ${mb(limits.maxBytes)}.`);
      return;
    }
    const url = URL.createObjectURL(chosen);
    urls.current.push(url);
    const item = { id: url, kind: "upload", file: chosen, url, label: chosen.name, gender };
    setFileError(null);
    setUploads((items) => [item, ...items]);
    setSelectedId(item.id);
  };

  // A template brings its own face: that exact picture goes on the canvas as a
  // photo, so the avatar made is the one the card showed. If it is not there
  // (not generated yet, offline) the library's own faces are used as before.
  const presetLoaded = useRef(null);
  useEffect(() => {
    if (!preset?.image || presetLoaded.current === preset.id) return undefined;
    presetLoaded.current = preset.id;
    let stopped = false;
    fetch(preset.image)
      .then((res) => (res.ok && res.headers.get("content-type")?.startsWith("image/") ? res.blob() : Promise.reject(new Error("no picture"))))
      .then((blob) => {
        if (stopped) return;
        const file = new File([blob], `${preset.id}.jpg`, { type: blob.type });
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        setGender(preset.gender);
        setUploads((items) => [{ id: url, kind: "upload", file, url, label: preset.label, gender: preset.gender }, ...items]);
        setSelectedId(url);
      })
      .catch(() => {
        presetLoaded.current = null;
      });
    return () => {
      stopped = true;
      presetLoaded.current = null;
    };
  }, [preset]);

  const choose = () => fileInput.current?.click();

  // ---- picture tools --------------------------------------------------------
  const [tool, setTool] = useState(null); // "crop" | "enhance" | "preview" | "generate" | "aiedit"
  const [working, setWorking] = useState(false);
  const [toolError, setToolError] = useState(null);

  // A vendor's own avatar is an agent on their side, not a picture to edit.
  const editable = Boolean(selected) && (selected.kind === "upload" || selected.providerId === "library");
  const editInfo = {
    name: selected?.file?.name || selected?.label,
    type: selected?.file?.type === "image/png" ? "image/png" : "image/jpeg",
    maxBytes: limits?.maxBytes,
  };
  // How a preview starts, per kind of face: a photo or a Library face becomes a
  // hidden draft that records a clip. A face that already has a clip just plays it.
  const previewStart =
    !selected || selected.videoUrl
      ? null
      : selected.kind === "upload"
        ? () => studioApi.preview.fromPhoto({ file: selected.file, name: "Untitled avatar", gender, behaviour })
        : selected.providerId === "library"
          ? () => studioApi.preview.fromStock({ providerAvatarId: selected.providerAvatarId, gender, behaviour })
          : null;
  const toolHint = !selected ? "Pick a face first" : "A vendor's avatar can't be edited here";

  // Whether the image service is set up, from the server, so the dialogs can say
  // so before anyone types a prompt. Editing also needs public image storage.
  const imageGen = options?.imageGeneration;
  const generateUnavailable =
    options && !imageGen?.generate
      ? "Image generation is not set up yet. An admin can add a Kie.ai key under Admin > API Keys."
      : null;
  const editUnavailable =
    generateUnavailable ||
    (options && !imageGen?.edit
      ? "Editing needs public image storage, which this server does not have set up. Generating still works."
      : null);

  /** The face as a File, for the image service: an upload already is one. */
  const currentFile = async () =>
    selected.kind === "upload"
      ? selected.file
      : canvasToFile(transformImage(await loadImage(selected.url)), editInfo);

  /** An edited picture becomes the face - always as an uploaded photo. */
  const applyEdit = (file) => {
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    const item = {
      id: url,
      kind: "upload",
      file,
      url,
      label: file.name,
      gender: selected.gender || gender,
      // What "Reset edits" goes back to: the face as it was before the first edit.
      original: selected.original || selected,
    };
    setUploads((items) => [item, ...items.filter((i) => i.id !== selected.id)]);
    setSelectedId(item.id);
    setFileError(null);
    setToolError(null);
    setTool(null);
  };

  /** A one-step edit (rotate, flip): runs, then becomes the face. */
  const quickEdit = async (render) => {
    setWorking(true);
    setToolError(null);
    try {
      applyEdit(await render());
    } catch (err) {
      setToolError(editError(err));
    } finally {
      setWorking(false);
    }
  };
  const transform = (options) =>
    quickEdit(async () => canvasToFile(transformImage(await loadImage(selected.url), options), editInfo));

  const download = async () => {
    setWorking(true);
    setToolError(null);
    try {
      const file =
        selected.kind === "upload"
          ? selected.file
          : await canvasToFile(transformImage(await loadImage(selected.url)), editInfo);
      const href = URL.createObjectURL(file);
      const link = Object.assign(document.createElement("a"), { href, download: file.name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err) {
      setToolError(editError(err));
    } finally {
      setWorking(false);
    }
  };

  const resetEdits = () => {
    const { original } = selected;
    setUploads((items) => {
      const rest = items.filter((i) => i.id !== selected.id);
      return original.kind === "upload" ? [original, ...rest] : rest;
    });
    setSelectedId(original.id);
    setToolError(null);
  };

  const removePhoto = () => {
    setUploads((items) => items.filter((i) => i.id !== selected.id));
    setSelectedId(null);
  };

  // Back to wherever they came from; a direct visit has nowhere to go back to.
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/"));

  const missing = !selected ? "Pick a face or add a photo." : null;
  const canSubmit = !missing && !(noVendor && !fromStock) && !busy;

  const dropProps = {
    onDragOver: (e) => {
      e.preventDefault();
      if (!busy) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      if (!busy) add(e.dataTransfer.files?.[0]);
    },
  };

  return (
    // Side by side from lg up; on phones the face is on top, the choices below
    // it, and the page scrolls with the create button pinned to the bottom.
    <div className="flex min-h-screen flex-col bg-bg text-text lg:h-screen lg:flex-row lg:overflow-hidden">
      <main className="relative flex min-w-0 flex-col lg:flex-1">
        {/* The chosen face, blurred behind everything, so the stage takes on its light. */}
        {selected && (
          <img
            src={selected.url}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-[0.12] blur-3xl"
          />
        )}

        <header className="relative flex h-16 shrink-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={back}
            disabled={busy}
            aria-label="Back"
            className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40"
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="text-h3 font-medium">Avatar creator</h1>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col items-center px-4 pb-4 sm:px-6">
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <div
              {...dropProps}
              className={clsx(
                "relative aspect-[2/3] h-[min(50dvh,420px)] max-w-full overflow-hidden rounded-lg transition-colors lg:h-full",
                selected ? "border border-border-strong" : "border border-dashed",
                dragging
                  ? "border-pink bg-pink-dim"
                  : !selected && "border-border-strong bg-surface",
              )}
            >
              {selected?.videoUrl ? (
                <video
                  key={selected.id}
                  src={selected.videoUrl}
                  poster={selected.url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-label={selected.label}
                  className="h-full w-full object-cover"
                />
              ) : selected ? (
                <img src={selected.url} alt={selected.label} className="h-full w-full object-cover" />
              ) : (
                <button
                  type="button"
                  onClick={choose}
                  disabled={busy}
                  className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center transition-colors hover:bg-surface-hover"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-text-muted">
                    <UploadIcon size={20} />
                  </span>
                  <span className="font-medium">Add a face</span>
                  <span className="text-ui text-text-muted">
                    A photo, an illustration, a mascot. Drop it here or choose a file.
                  </span>
                  {limits && (
                    <span className="text-ui text-text-faint">
                      {formatTypes(limits.types)} · up to {mb(limits.maxBytes)}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-sm border border-border-strong bg-surface p-1">
              <ToolButton label="Upload photo" onClick={choose} disabled={busy}>
                <UploadIcon />
              </ToolButton>
              <ToolMenu
                label="Create with AI"
                align="left"
                disabled={busy || working}
                items={[
                  { label: "Generate image", icon: <WandIcon />, onSelect: () => setTool("generate") },
                  {
                    label: "Edit image",
                    icon: <PencilIcon />,
                    onSelect: () => setTool("aiedit"),
                    disabled: !editable,
                    title: editable ? undefined : toolHint,
                  },
                ]}
              >
                <WandIcon />
              </ToolMenu>
              <ToolButton
                label={editable ? "Crop" : toolHint}
                onClick={() => setTool("crop")}
                disabled={busy || working || !editable}
              >
                <CropIcon />
              </ToolButton>
              <ToolMenu
                label="More"
                disabled={busy || working || !selected}
                items={[
                  { label: "Adjust colour and brightness", onSelect: () => setTool("enhance"), hidden: !editable },
                  { label: "Rotate left", onSelect: () => transform({ rotate: -90 }), hidden: !editable },
                  { label: "Rotate right", onSelect: () => transform({ rotate: 90 }), hidden: !editable },
                  { label: "Flip horizontally", onSelect: () => transform({ flip: true }), hidden: !editable },
                  { label: "Download picture", onSelect: download, hidden: !editable },
                  { separator: true, hidden: !editable },
                  { label: "Reset edits", onSelect: resetEdits, hidden: !selected?.original },
                  { label: "Remove photo", onSelect: removePhoto, danger: true, hidden: selected?.kind !== "upload" },
                  { label: "Nothing to change on a vendor's avatar", onSelect: () => {}, disabled: true, hidden: editable },
                ]}
              >
                <MoreIcon />
              </ToolMenu>
            </div>
            <button
              type="button"
              disabled={!selected || busy}
              onClick={() => setTool("preview")}
              className="flex h-10 items-center gap-2 rounded-sm border border-border-strong bg-surface px-4 text-ui font-medium transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface"
            >
              <PlayIcon />
              Preview
            </button>
          </div>

          {(fileError || toolError) && <p className="mt-2 text-ui text-red">{fileError || toolError}</p>}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={limits?.types.join(",") || "image/*"}
          className="hidden"
          onChange={(e) => {
            add(e.target.files?.[0]);
            // Cleared so choosing the same file again still fires a change.
            e.target.value = "";
          }}
        />

        {editable && (
          <>
            <CropDialog
              open={tool === "crop"}
              src={selected.url}
              {...editInfo}
              onApply={applyEdit}
              onClose={() => setTool(null)}
            />
            <EnhanceDialog
              open={tool === "enhance"}
              src={selected.url}
              {...editInfo}
              onApply={applyEdit}
              onClose={() => setTool(null)}
            />
          </>
        )}
        <GenerateDialog
          open={tool === "generate"}
          unavailable={generateUnavailable}
          onUse={(file) => {
            // A generated picture is added like any uploaded photo, and becomes the face.
            add(file);
            setTool(null);
          }}
          onClose={() => setTool(null)}
        />
        <EditImageDialog
          open={tool === "aiedit"}
          unavailable={editUnavailable}
          getFile={currentFile}
          onApply={applyEdit}
          onClose={() => setTool(null)}
        />
        <PreviewDialog
          open={tool === "preview"}
          item={selected}
          start={previewStart}
          onKept={(avatar) => {
            // The preview's draft is now the avatar: open it, nothing is created twice.
            queryClient.invalidateQueries({ queryKey: ["avatars"] });
            navigate(`/avatars/${avatar._id}`);
          }}
          onClose={() => setTool(null)}
        />
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-border bg-surface lg:w-[330px] lg:border-l lg:border-t-0">
        <div className="flex-1 space-y-7 px-4 pb-5 pt-6 sm:px-5 lg:overflow-y-auto">
          {noVendor && (
            <p className="rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">
              No avatar vendor is set up, so a photo cannot be animated yet. Add{" "}
              <code className="font-mono">LEMONSLICE_API_KEY</code> to{" "}
              <code className="font-mono">server/.env</code> and restart the server.
            </p>
          )}

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-ui font-medium">Voice</h2>
              <button
                type="button"
                disabled
                title={`Listen (${SOON.toLowerCase()})`}
                aria-label="Listen to voice"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-text-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <SpeakerIcon />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded border border-border-strong bg-bg p-1">
              {GENDERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={gender === option.value}
                  onClick={() => setGender(option.value)}
                  className={clsx(
                    "h-9 rounded-sm text-ui font-medium transition-colors disabled:opacity-40",
                    gender === option.value
                      ? "bg-surface-3 text-text"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {customVoices.length > 0 && (
              <label className="mt-3 block">
                <span className="text-label text-text-muted">Speaks with</span>
                <select
                  value={ownVoice}
                  disabled={busy}
                  onChange={(e) => setOwnVoice(e.target.value)}
                  className="mt-1.5 h-10 w-full cursor-pointer rounded border border-border-strong bg-bg px-3 text-ui font-medium text-text outline-none [color-scheme:dark] focus:border-text-muted disabled:opacity-50"
                >
                  <option value="">Default {gender} voice</option>
                  <optgroup label="Your voices">
                    {customVoices.map((v) => (
                      <option key={v._id} value={v.providerVoiceId}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            )}
          </section>

          <section>
            <h2 className="text-ui font-medium">Library</h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-3">
              <button
                type="button"
                onClick={choose}
                disabled={busy}
                aria-label="Add a photo"
                {...dropProps}
                className={clsx(
                  "flex aspect-square items-center justify-center rounded-sm border text-text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-40",
                  dragging ? "border-pink bg-pink-dim" : "border-border bg-surface-2",
                )}
              >
                <PlusIcon />
              </button>

              {library.map((item) => {
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedId(item.id)}
                    aria-label={item.label}
                    aria-pressed={active}
                    title={item.label}
                    className={clsx(
                      "relative aspect-square overflow-hidden rounded-sm border transition-colors disabled:opacity-40",
                      active ? "border-text" : "border-border hover:border-border-strong",
                    )}
                  >
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                    {active && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-text text-text-inverse">
                          <CheckIcon />
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {stockLoading && <p className="mt-3 text-ui text-text-faint">Loading templates…</p>}
            {stockError && (
              <p className="mt-3 text-ui text-red">Could not load templates: {stockError.message}</p>
            )}
            {!stockLoading && library.length === 0 && (
              <p className="mt-3 text-ui text-text-faint">
                No {gender} characters yet. Add a photo, or create one in LemonSlice.
              </p>
            )}

            {fromStock && (
              <CharacterTag
                item={selected}
                saving={tag.isPending}
                error={tag.error?.message}
                disabled={busy}
                onTag={(value) => tag.mutate(value)}
              />
            )}
          </section>
        </div>

        <div className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-surface p-4 lg:static">

          {create.isError && <p className="mb-3 text-ui text-red">{create.error.message}</p>}
          {missing && <p className="mb-3 text-ui text-text-faint">{missing}</p>}
          <div className="flex h-11 overflow-hidden rounded-sm bg-text text-text-inverse">
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={!canSubmit}
              className="flex-1 text-ui font-semibold transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create avatar"}
            </button>
            <button
              type="button"
              disabled
              title={`More options (${SOON.toLowerCase()})`}
              aria-label="More create options"
              className="flex w-11 items-center justify-center border-l border-black/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDownIcon />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * A ready-made face's gender. Asked once, as a question, while it has none;
 * after that a quiet line with a way to correct it.
 */
function CharacterTag({ item, saving, error, disabled, onTag }) {
  const other = item.gender === "female" ? "male" : "female";

  return (
    <div className="mt-4">
      {item.gender ? (
        <p className="text-ui text-text-faint">
          {item.label} is listed as a {item.gender} character.{" "}
          <button
            type="button"
            onClick={() => onTag(other)}
            disabled={saving || disabled}
            className="text-text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-40"
          >
            Move to {other}
          </button>
        </p>
      ) : (
        <div className="rounded border border-border-strong bg-surface-2 p-3">
          <p className="text-ui">Is {item.label} a female or male character?</p>
          <p className="mt-1 text-ui text-text-faint">Asked once, so it shows under the right tab.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {GENDERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onTag(option.value)}
                disabled={saving || disabled}
                className="h-8 rounded-sm border border-border-strong text-ui font-medium transition-colors hover:bg-surface-3 disabled:opacity-40"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-ui text-red">{error}</p>}
    </div>
  );
}

function ToolButton({ label, children, ...rest }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      {...rest}
    >
      {children}
    </button>
  );
}

const mb = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** "image/jpeg" → "JPG", for a list a person can read. */
const formatTypes = (types) =>
  types.map((t) => t.split("/")[1].toUpperCase().replace("JPEG", "JPG")).join(", ");

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

function ChevronDownIcon({ className }) {
  return (
    <svg {...stroke} className={className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function UploadIcon({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size}>
      <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

function WandIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 13.5l8-8M9 4l1.5 1.5M12 2v2M13 3h-2M13.5 7.5v1.5M14.25 8.25h-1.5M6.5 1.5v1.5M7.25 2.25h-1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg {...stroke}>
      <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />
    </svg>
  );
}

function CropIcon() {
  return (
    <svg {...stroke}>
      <path d="M4 1.5V12h10.5M1.5 4H12v10.5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...stroke} fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.5" cy="8" r="1.1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg {...stroke}>
      <path d="M4.5 2.75v10.5L13 8z" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg {...stroke}>
      <path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.75a6 6 0 0 1 0 8.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...stroke} width={18} height={18}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...stroke} width={12} height={12} strokeWidth={2}>
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
