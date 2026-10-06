import { useEffect, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import {
  adjustToCanvas,
  canvasToFile,
  editError,
  loadImage,
  samplePixels,
  suggestAdjustments,
} from "./imageTools";

/**
 * Enhance: brightness, contrast and colour, with an Auto that looks at the
 * picture first. It is a tone adjustment, not AI upscaling - it will not add
 * detail, but it rescues a dim or flat photo before it is animated.
 *
 * The preview is a CSS filter over the picture; Apply runs the same maths on
 * the pixels, so what is shown is what is saved.
 */
const NEUTRAL = { brightness: 1, contrast: 1, saturation: 1 };

const SLIDERS = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Colour" },
];

export default function EnhanceDialog({ open, src, name, type, maxBytes, onApply, onClose }) {
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [values, setValues] = useState(NEUTRAL);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setImg(null);
    setError(null);
    setValues(NEUTRAL);
    loadImage(src)
      .then((loaded) => live && setImg(loaded))
      .catch((err) => live && setError(editError(err)));
    return () => {
      live = false;
    };
  }, [open, src]);

  const changed = SLIDERS.some(({ key }) => values[key] !== 1);

  const auto = () => {
    try {
      setValues(suggestAdjustments(samplePixels(img)));
      setError(null);
    } catch (err) {
      setError(editError(err));
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await canvasToFile(adjustToCanvas(img, values), { name, type, maxBytes });
      onApply(file);
    } catch (err) {
      setError(editError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Enhance"
      description="Brighten a dim photo or add a little contrast before the avatar is made."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!img || !changed || busy}>
            {busy ? "Saving…" : "Apply"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex items-center justify-center rounded-lg border border-border bg-surface-3 p-2">
          {img ? (
            <img
              src={src}
              alt="Preview"
              style={{
                filter: `brightness(${values.brightness}) contrast(${values.contrast}) saturate(${values.saturation})`,
              }}
              className="max-h-[50vh] w-auto max-w-full rounded object-contain"
            />
          ) : (
            <span className="py-16 text-ui text-text-faint">{error ? "" : "Loading…"}</span>
          )}
        </div>

        <div className="space-y-5">
          {SLIDERS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="flex items-center justify-between text-ui text-text-muted">
                {label}
                <span className="tabular-nums text-text-faint">{Math.round(values[key] * 100)}%</span>
              </span>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.01"
                value={values[key]}
                disabled={!img}
                onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
                className="mt-2 w-full"
                aria-label={label}
              />
            </label>
          ))}

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={auto} disabled={!img || busy}>
              Auto
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setValues(NEUTRAL)} disabled={!changed || busy}>
              Reset
            </Button>
          </div>

          {error && <p className="text-ui text-red">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
