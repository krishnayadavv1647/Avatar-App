/**
 * The avatar creator's picture tools: crop, enhance, rotate, flip.
 *
 * Everything runs in the browser and ends as a File, because that is what the
 * server takes on create - an edited face is simply a new uploaded photo. The
 * maths is kept apart from the canvas calls (and takes plain numbers and byte
 * arrays) so it can be tested without a browser.
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The weights CSS uses for saturate(), so what the dialog previews with a CSS
// filter is what the pixels end up as.
const LUMA = [0.213, 0.715, 0.072];

/**
 * Brightness, contrast and saturation on RGBA bytes, in place. 1 leaves a
 * channel alone. Written to a Uint8ClampedArray, which clamps to 0-255 itself.
 */
export function adjustPixels(data, { brightness = 1, contrast = 1, saturation = 1 }) {
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * brightness;
    let g = data[i + 1] * brightness;
    let b = data[i + 2] * brightness;

    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    const luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
    data[i] = luma + (r - luma) * saturation;
    data[i + 1] = luma + (g - luma) * saturation;
    data[i + 2] = luma + (b - luma) * saturation;
  }
  return data;
}

/**
 * "Auto": adjustments chosen from the picture itself. A dark photo is
 * brightened, a flat one gets more contrast, one already in range is left
 * nearly alone - the limits keep a good photo from being pushed around.
 */
export function suggestAdjustments(data) {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const luma = LUMA[0] * data[i] + LUMA[1] * data[i + 1] + LUMA[2] * data[i + 2];
    sum += luma;
    sumSq += luma * luma;
    count += 1;
  }
  if (!count) return { brightness: 1, contrast: 1, saturation: 1 };

  const mean = sum / count;
  const spread = Math.sqrt(Math.max(0, sumSq / count - mean * mean));

  // Mostly a rescue for dim photos: a bright one is only eased, never darkened much.
  const brightness = mean > 1 ? clamp(125 / mean, 0.9, 1.3) : 1;
  const contrast = spread > 1 ? clamp(58 / (spread * brightness), 0.9, 1.4) : 1;
  return {
    brightness: Math.round(brightness * 100) / 100,
    contrast: Math.round(contrast * 100) / 100,
    saturation: 1.08,
  };
}

/**
 * Keeps the picture covering the frame: it can be dragged, but never far
 * enough to show an empty edge. `pan` is how far the picture's centre sits
 * from the frame's centre, in frame pixels.
 */
export function clampPan({ imgW, imgH, frameW, frameH, zoom, panX, panY }) {
  const scale = Math.max(frameW / imgW, frameH / imgH) * zoom;
  const maxX = Math.max(0, (imgW * scale - frameW) / 2);
  const maxY = Math.max(0, (imgH * scale - frameH) / 2);
  // "+ 0" turns a clamped -0 into 0, which would otherwise show up as a stray sign.
  return { x: clamp(panX, -maxX, maxX) + 0, y: clamp(panY, -maxY, maxY) + 0, scale };
}

/** The part of the picture, in its own pixels, that the frame is showing. */
export function cropSource({ imgW, imgH, frameW, frameH, zoom, panX, panY }) {
  const { x, y, scale } = clampPan({ imgW, imgH, frameW, frameH, zoom, panX, panY });
  return {
    sx: (imgW * scale - frameW) / 2 / scale - x / scale,
    sy: (imgH * scale - frameH) / 2 / scale - y / scale,
    sw: frameW / scale,
    sh: frameH / scale,
  };
}

/** Largest long edge an edit is written at; a phone photo is far bigger than a face needs. */
export const MAX_EDGE = 2048;

// ---- canvas ----------------------------------------------------------------

/**
 * Loads a picture so it can be drawn. `crossOrigin` matters for a library face
 * (another host): without it the canvas is "tainted" and cannot be read back.
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load that picture."));
    img.src = src;
  });
}

const sizeOf = (source) => ({
  w: source.naturalWidth || source.width,
  h: source.naturalHeight || source.height,
});

function makeCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

/** The picture turned by a quarter-turn step (-90, 90, 180) and/or mirrored. */
export function transformImage(source, { rotate = 0, flip = false } = {}) {
  const { w, h } = sizeOf(source);
  const sideways = Math.abs(rotate) % 180 === 90;
  const canvas = makeCanvas(sideways ? h : w, sideways ? w : h);
  const ctx = canvas.getContext("2d");

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(source, -w / 2, -h / 2);
  return canvas;
}

/** A region of the picture, at its own resolution (capped at MAX_EDGE). */
export function cropToCanvas(source, { sx, sy, sw, sh }) {
  const shrink = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const canvas = makeCanvas(sw * shrink, sh * shrink);
  canvas.getContext("2d").drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The picture with brightness, contrast and saturation applied, capped at MAX_EDGE. */
export function adjustToCanvas(source, adjustments) {
  const { w, h } = sizeOf(source);
  const shrink = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = makeCanvas(w * shrink, h * shrink);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  adjustPixels(pixels.data, adjustments);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** Pixels of a small copy of the picture, enough for "Auto" to look at. */
export function samplePixels(source, edge = 200) {
  const { w, h } = sizeOf(source);
  const shrink = Math.min(1, edge / Math.max(w, h));
  const canvas = makeCanvas(w * shrink, h * shrink);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/**
 * The canvas as a File no bigger than `maxBytes`. A PNG does not shrink with
 * quality, so one that is too big becomes a JPEG; a JPEG gives up quality and
 * then size, a little at a time, before the edit is refused.
 */
export async function canvasToFile(canvas, { name, type = "image/jpeg", maxBytes = Infinity }) {
  let work = canvas;
  let mime = type;
  let quality = 0.92;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const blob = await new Promise((resolve) => work.toBlob(resolve, mime, quality));
    if (!blob) throw new Error("Could not save the edited picture.");
    if (blob.size <= maxBytes) return new File([blob], editedName(name, mime), { type: mime });

    if (mime === "image/png") mime = "image/jpeg";
    else if (quality > 0.6) quality -= 0.1;
    else {
      const smaller = makeCanvas(work.width * 0.85, work.height * 0.85);
      smaller.getContext("2d").drawImage(work, 0, 0, smaller.width, smaller.height);
      work = smaller;
    }
  }
  throw new Error("The edited picture is still too large. Try a smaller photo.");
}

/** "face.png" -> "face-edited.png"; a name that is already edited is not edited again. */
export function editedName(name = "face", mime = "image/jpeg") {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const base = String(name).replace(/\.[a-z0-9]+$/i, "").replace(/-edited$/, "") || "face";
  return `${base}-edited.${ext}`;
}

/** What went wrong, in words, when the canvas cannot be read back (another host's picture). */
export function editError(err) {
  if (err?.name === "SecurityError") {
    return "This picture's host does not allow editing it. Save it and add it as a photo instead.";
  }
  return err?.message || "Could not edit that picture.";
}
