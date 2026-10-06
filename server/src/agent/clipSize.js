/**
 * The size to record an avatar's preview clip at.
 *
 * The recorder (LiveKit track-composite egress) draws the video track into a
 * frame of the size it is given and, when the track's shape differs, fills the
 * rest with black - the bars that used to sit left and right of the face. So
 * the frame must be the track's own shape. Its real size is asked of the room
 * when it is known; the vendor's nominal ratio is only the fallback.
 *
 * Encoders need even sizes, and a card never shows more than this.
 */
const MAX_EDGE = 768;

/** The nominal shapes the renderer can be asked for, used when the track's size is unknown. */
const NOMINAL = {
  "2x3": { width: 480, height: 720 },
  "9x16": { width: 432, height: 768 },
  "1x1": { width: 540, height: 540 },
};

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * @param {{ trackWidth?: number, trackHeight?: number, aspectRatio?: string }} input
 * @returns {{ width: number, height: number }}
 */
export function clipSizeFor({ trackWidth, trackHeight, aspectRatio } = {}) {
  if (trackWidth > 0 && trackHeight > 0) {
    // The track's own size, shrunk only if it is bigger than a card needs.
    const shrink = Math.min(1, MAX_EDGE / Math.max(trackWidth, trackHeight));
    return { width: even(trackWidth * shrink), height: even(trackHeight * shrink) };
  }
  return NOMINAL[aspectRatio] || NOMINAL["2x3"];
}
