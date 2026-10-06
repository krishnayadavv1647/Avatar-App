import "../setup-env.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { clipSizeFor } from "../../src/agent/clipSize.js";

describe("clipSizeFor", () => {
  test("records at the track's own shape, so there is nothing to fill with black", () => {
    // A 2:3 request does not always arrive as exactly 2:3.
    assert.deepEqual(clipSizeFor({ trackWidth: 464, trackHeight: 736, aspectRatio: "2x3" }), {
      width: 464,
      height: 736,
    });
    const { width, height } = clipSizeFor({ trackWidth: 352, trackHeight: 560 });
    assert.ok(Math.abs(width / height - 352 / 560) < 0.01);
  });

  test("never makes a frame bigger than a card needs, and keeps the shape when shrinking", () => {
    const { width, height } = clipSizeFor({ trackWidth: 1080, trackHeight: 1920 });
    assert.ok(Math.max(width, height) <= 768);
    assert.ok(Math.abs(width / height - 1080 / 1920) < 0.01);
  });

  test("sizes are even, which the encoder requires", () => {
    for (const [w, h] of [[351, 559], [333, 501], [1, 1], [767, 769]]) {
      const size = clipSizeFor({ trackWidth: w, trackHeight: h });
      assert.equal(size.width % 2, 0);
      assert.equal(size.height % 2, 0);
    }
  });

  test("falls back to the nominal shape when the track's size is not known yet", () => {
    assert.deepEqual(clipSizeFor({ aspectRatio: "9x16" }), { width: 432, height: 768 });
    assert.deepEqual(clipSizeFor({ aspectRatio: "1x1" }), { width: 540, height: 540 });
    assert.deepEqual(clipSizeFor({}), { width: 480, height: 720 });
    assert.deepEqual(clipSizeFor({ trackWidth: 0, trackHeight: 0, aspectRatio: "2x3" }), { width: 480, height: 720 });
  });
});
