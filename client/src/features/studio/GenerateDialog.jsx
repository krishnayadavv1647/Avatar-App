import { useEffect, useRef, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Segmented from "@/components/forms/Segmented";
import { studioApi } from "@/services/studio.api";
import { usePictureMaker } from "./imageGen";
import PromptBar, { RoundButton, Spinner } from "./PromptBar";

/**
 * "Generate image": describe a face, get a picture to use as the avatar.
 *
 * Empty, it is just the prompt in the middle of the dialog. Once a picture is
 * made it shows above the prompt, so the person can keep asking for another;
 * every picture made this visit stays in a strip, and "Use this image" sends
 * the chosen one back to the creator as a photo.
 */
const SHAPES = [
  { value: "3:4", label: "Portrait" },
  { value: "9:16", label: "Tall" },
  { value: "1:1", label: "Square" },
];

export default function GenerateDialog({ open, unavailable, onUse, onClose }) {
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState("3:4");
  const [settings, setSettings] = useState(false);
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const maker = usePictureMaker();
  const popover = useRef(null);

  // A fresh start each time it opens; the pictures' addresses are released when it closes.
  useEffect(() => {
    if (open) return undefined;
    setPrompt("");
    setSettings(false);
    setActive(0);
    setResults((list) => {
      list.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!settings) return undefined;
    const close = (e) => !popover.current?.contains(e.target) && setSettings(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [settings]);

  const close = () => {
    maker.cancel();
    onClose();
  };

  const generate = async () => {
    setSettings(false);
    const file = await maker.run(() => studioApi.image.generate({ prompt: prompt.trim(), aspectRatio: shape }));
    if (!file) return;
    setResults((list) => [{ file, url: URL.createObjectURL(file), prompt: prompt.trim() }, ...list]);
    setActive(0);
  };

  const current = results[active];
  const hasContent = maker.busy || Boolean(current);

  const bar = (
    <PromptBar
      value={prompt}
      onChange={setPrompt}
      onSubmit={generate}
      placeholder="Enter image prompt"
      disabled={Boolean(unavailable)}
      busy={maker.busy}
      autoFocus
      before={
        <div ref={popover} className="relative">
          <RoundButton label="Settings" onClick={() => setSettings((v) => !v)} aria-expanded={settings} disabled={maker.busy}>
            <SlidersIcon />
          </RoundButton>
          {settings && (
            <div
              role="dialog"
              aria-label="Image settings"
              className="absolute bottom-full left-0 z-10 mb-2 w-[280px] rounded-lg border border-border bg-surface p-4 shadow-lg"
            >
              <p className="text-ui font-medium">Shape</p>
              <div className="mt-2">
                <Segmented value={shape} onChange={setShape} options={SHAPES} />
              </div>
              <p className="mt-3 text-label text-text-faint">Portrait suits most avatars.</p>
            </div>
          )}
        </div>
      }
    />
  );

  return (
    <Modal open={open} onClose={close} title="Generate">
      <div className="flex min-h-[480px] flex-col px-6 pb-6 pt-4">
        {unavailable && (
          <p className="mb-4 rounded border border-border-strong bg-surface-2 px-4 py-3 text-ui text-yellow">{unavailable}</p>
        )}

        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {maker.busy && <Spinner label="Generating…" />}

          {!maker.busy && current && (
            <>
              <img
                src={current.url}
                alt={current.prompt}
                className="max-h-[46vh] w-auto max-w-full rounded-lg border border-border-strong object-contain"
              />
              {results.length > 1 && (
                <div className="flex max-w-full gap-2 overflow-x-auto py-1">
                  {results.map((r, i) => (
                    <button
                      key={r.url}
                      type="button"
                      onClick={() => setActive(i)}
                      aria-label={`Picture ${results.length - i}`}
                      aria-pressed={i === active}
                      className={`h-14 w-11 shrink-0 overflow-hidden rounded-sm border ${i === active ? "border-text" : "border-border"}`}
                    >
                      <img src={r.url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <Button onClick={() => onUse(current.file)}>Use this image</Button>
            </>
          )}

          {!hasContent && <div className="w-full max-w-[460px]">{bar}</div>}
          {!hasContent && maker.error && <p className="text-ui text-red">{maker.error}</p>}
        </div>

        {hasContent && (
          <div className="mt-4">
            {maker.error && <p className="mb-2 text-center text-ui text-red">{maker.error}</p>}
            <div className="mx-auto w-full max-w-[460px]">{bar}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M2 5h6M12 5h2M2 11h2M8 11h6" />
      <circle cx="10" cy="5" r="1.7" />
      <circle cx="6" cy="11" r="1.7" />
    </svg>
  );
}
