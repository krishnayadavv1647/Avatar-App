import { useEffect, useRef, useState } from "react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import Segmented from "@/components/forms/Segmented";
import { canvasToFile, clampPan, cropSource, cropToCanvas, editError, loadImage } from "./imageTools";

/**
 * Crop: a fixed frame the picture is dragged and zoomed under.
 *
 * The frame has the shape the avatar will be drawn in (the three shapes the
 * renderer offers), so what is inside it is what the face will be. Dragging
 * and zooming never show an empty edge. The result is written at the picture's
 * own resolution, not the on-screen size.
 */
const FRAME_W = 280;
const SHAPES = [
  { value: "2x3", label: "2:3", ratio: 3 / 2 },
  { value: "9x16", label: "9:16", ratio: 16 / 9 },
  { value: "1x1", label: "1:1", ratio: 1 },
];

export default function CropDialog({ open, src, name, type, maxBytes, onApply, onClose }) {
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [shape, setShape] = useState("2x3");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);

  const ratio = SHAPES.find((s) => s.value === shape).ratio;
  const frameH = Math.round(FRAME_W * ratio);

  // A fresh start each time it opens, on whatever is the current face.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setImg(null);
    setError(null);
    setShape("2x3");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    loadImage(src)
      .then((loaded) => live && setImg(loaded))
      .catch((err) => live && setError(editError(err)));
    return () => {
      live = false;
    };
  }, [open, src]);

  const geometry = img && {
    imgW: img.naturalWidth,
    imgH: img.naturalHeight,
    frameW: FRAME_W,
    frameH,
  };

  // Changing the shape or the zoom can leave the picture off-centre; pull it back.
  const settle = (next) => setPan(({ x, y }) => {
    const c = clampPan({ ...geometry, zoom: next.zoom ?? zoom, panX: x, panY: y });
    return { x: c.x, y: c.y };
  });

  const view = geometry && clampPan({ ...geometry, zoom, panX: pan.x, panY: pan.y });

  const onPointerDown = (e) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const c = clampPan({
      ...geometry,
      zoom,
      panX: drag.current.pan.x + e.clientX - drag.current.x,
      panY: drag.current.pan.y + e.clientY - drag.current.y,
    });
    setPan({ x: c.x, y: c.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const rect = cropSource({ ...geometry, zoom, panX: pan.x, panY: pan.y });
      const file = await canvasToFile(cropToCanvas(img, rect), { name, type, maxBytes });
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
      title="Crop"
      description="Drag the picture to place the face, and zoom to fill the frame."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!img || busy}>
            {busy ? "Cropping…" : "Apply crop"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-5 px-6 py-5">
        <Segmented
          value={shape}
          onChange={(value) => {
            setShape(value);
            // The frame changes height; re-fit on the next render with the new size.
            setPan({ x: 0, y: 0 });
          }}
          options={SHAPES.map(({ value, label }) => ({ value, label }))}
        />

        <div
          role="img"
          aria-label="Crop area"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: FRAME_W, height: frameH, touchAction: "none" }}
          className="relative cursor-grab overflow-hidden rounded-lg border border-border-strong bg-surface-3 active:cursor-grabbing"
        >
          {img && view && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: img.naturalWidth * view.scale,
                height: img.naturalHeight * view.scale,
                maxWidth: "none",
                transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px))`,
              }}
              className="select-none"
            />
          )}
          {!img && !error && (
            <span className="absolute inset-0 flex items-center justify-center text-ui text-text-faint">Loading…</span>
          )}
        </div>

        <label className="flex w-full max-w-[280px] items-center gap-3 text-ui text-text-muted">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            disabled={!img}
            onChange={(e) => {
              const next = Number(e.target.value);
              setZoom(next);
              settle({ zoom: next });
            }}
            className="flex-1"
            aria-label="Zoom"
          />
        </label>

        {error && <p className="text-ui text-red">{error}</p>}
      </div>
    </Modal>
  );
}
