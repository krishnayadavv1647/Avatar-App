import { useEffect, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { studioApi } from "@/services/studio.api";
import { editError } from "./imageTools";
import { usePictureMaker } from "./imageGen";
import PromptBar, { RoundButton, Spinner } from "./PromptBar";

/**
 * "Edit image": describe a change in words ("make the sweater red", "add
 * glasses") and the picture is redone. Each change is a step in a history, so
 * undo and redo walk it; Done keeps the picture as it is now.
 *
 * `getFile` returns the face being edited as a File - the creator knows how for
 * an uploaded photo and for a library face alike.
 */
export default function EditImageDialog({ open, getFile, unavailable, onApply, onClose }) {
  const [history, setHistory] = useState([]);
  const [index, setIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [loadError, setLoadError] = useState(null);
  const maker = usePictureMaker();

  // Starts from the face as it is when the dialog opens; closing releases the pictures.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setHistory([]);
    setIndex(0);
    setPrompt("");
    setLoadError(null);
    getFile()
      .then((file) => live && setHistory([{ file, url: URL.createObjectURL(file) }]))
      .catch((err) => live && setLoadError(editError(err)));
    return () => {
      live = false;
      setHistory((list) => {
        list.forEach((h) => URL.revokeObjectURL(h.url));
        return [];
      });
    };
    // getFile is rebuilt on every render of the creator; it only matters at open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = history[index];
  const changed = index > 0;

  const edit = async () => {
    const text = prompt.trim();
    const file = await maker.run(() => studioApi.image.edit(current.file, text));
    if (!file) return;
    // A new edit replaces whatever "redo" would have brought back.
    setHistory((list) => [...list.slice(0, index + 1), { file, url: URL.createObjectURL(file) }]);
    setIndex((i) => i + 1);
    setPrompt("");
  };

  const close = () => {
    maker.cancel();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Edit image">
      <div className="flex flex-col items-center gap-5 px-6 pb-6 pt-4">
        {unavailable && (
          <p className="w-full rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">{unavailable}</p>
        )}

        <div className="relative flex min-h-[320px] w-full items-center justify-center">
          {current ? (
            <img
              src={current.url}
              alt="The picture being edited"
              className="max-h-[52vh] w-auto max-w-full rounded-lg border border-border-strong object-contain"
            />
          ) : (
            !loadError && <Spinner label="Loading…" />
          )}
          {maker.busy && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60">
              <Spinner label="Editing…" />
            </div>
          )}
        </div>

        {(loadError || maker.error) && <p className="text-ui text-red">{loadError || maker.error}</p>}

        <div className="w-full max-w-[640px]">
          <PromptBar
            value={prompt}
            onChange={setPrompt}
            onSubmit={edit}
            placeholder="Describe an edit"
            disabled={Boolean(unavailable) || !current}
            busy={maker.busy}
            autoFocus
            before={
              <>
                <RoundButton label="Undo" onClick={() => setIndex((i) => i - 1)} disabled={index === 0 || maker.busy}>
                  <UndoIcon />
                </RoundButton>
                <RoundButton
                  label="Redo"
                  onClick={() => setIndex((i) => i + 1)}
                  disabled={index >= history.length - 1 || maker.busy}
                >
                  <UndoIcon flip />
                </RoundButton>
              </>
            }
            after={
              <Button
                variant="secondary"
                className="h-11 rounded-full px-5"
                disabled={maker.busy}
                onClick={() => {
                  if (changed) onApply(current.file);
                  else close();
                }}
              >
                Done
              </Button>
            }
          />
        </div>
      </div>
    </Modal>
  );
}

function UndoIcon({ flip = false }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5.5 3 2.5 6l3 3M2.5 6H10a3.5 3.5 0 0 1 0 7H7" />
    </svg>
  );
}
