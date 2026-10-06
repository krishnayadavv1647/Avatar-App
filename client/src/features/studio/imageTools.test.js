import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { adjustPixels, clampPan, cropSource, editedName, suggestAdjustments } from "./imageTools.js";

const px = (...rgba) => new Uint8ClampedArray(rgba);

describe("adjustPixels", () => {
  test("leaves a picture alone at 1, 1, 1", () => {
    const data = px(10, 120, 250, 255);
    assert.deepEqual([...adjustPixels(data, {})], [10, 120, 250, 255]);
  });

  test("brightness scales, and clamps at the ends", () => {
    const data = px(100, 200, 10, 255);
    adjustPixels(data, { brightness: 1.5 });
    assert.deepEqual([...data], [150, 255, 15, 255]);
  });

  test("contrast pushes away from mid grey", () => {
    const data = px(100, 156, 128, 255);
    adjustPixels(data, { contrast: 2 });
    assert.deepEqual([...data], [72, 184, 128, 255]);
  });

  test("zero saturation makes grey, and keeps alpha", () => {
    const data = px(255, 0, 0, 77);
    adjustPixels(data, { saturation: 0 });
    assert.equal(data[0], data[1]);
    assert.equal(data[1], data[2]);
    assert.equal(data[3], 77);
  });
});

describe("suggestAdjustments", () => {
  const flat = (value, n = 400) => {
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
    return data;
  };

  test("brightens a dark picture, and only eases a bright one", () => {
    assert.ok(suggestAdjustments(flat(40)).brightness > 1);
    assert.equal(suggestAdjustments(flat(240)).brightness, 0.9);
    assert.equal(suggestAdjustments(flat(125)).brightness, 1);
  });

  test("stays inside sane limits", () => {
    for (const v of [1, 40, 120, 250]) {
      const s = suggestAdjustments(flat(v));
      assert.ok(s.brightness >= 0.9 && s.brightness <= 1.3);
      assert.ok(s.contrast >= 0.9 && s.contrast <= 1.4);
    }
  });

  test("copes with an empty picture", () => {
    assert.deepEqual(suggestAdjustments(new Uint8ClampedArray(0)), { brightness: 1, contrast: 1, saturation: 1 });
  });
});

describe("cropping", () => {
  const frame = { frameW: 200, frameH: 300 };

  test("an exactly matching picture shows all of itself", () => {
    const rect = cropSource({ imgW: 400, imgH: 600, ...frame, zoom: 1, panX: 0, panY: 0 });
    assert.deepEqual(rect, { sx: 0, sy: 0, sw: 400, sh: 600 });
  });

  test("a wide picture is cropped to the frame's shape, centred", () => {
    const rect = cropSource({ imgW: 1200, imgH: 600, ...frame, zoom: 1, panX: 0, panY: 0 });
    assert.equal(rect.sh, 600);
    assert.equal(rect.sw, 400);
    assert.equal(rect.sx, 400);
  });

  test("zooming in shows less of the picture", () => {
    const rect = cropSource({ imgW: 400, imgH: 600, ...frame, zoom: 2, panX: 0, panY: 0 });
    assert.equal(rect.sw, 200);
    assert.equal(rect.sh, 300);
  });

  test("the picture can never be dragged to show an empty edge", () => {
    const { x, y } = clampPan({ imgW: 400, imgH: 600, ...frame, zoom: 1, panX: 999, panY: -999 });
    assert.equal(x, 0);
    assert.equal(y, 0);

    const zoomed = clampPan({ imgW: 400, imgH: 600, ...frame, zoom: 2, panX: 999, panY: 999 });
    assert.equal(zoomed.x, 100);
    assert.equal(zoomed.y, 150);
  });

  test("dragging moves the window the opposite way", () => {
    const rect = cropSource({ imgW: 400, imgH: 600, ...frame, zoom: 2, panX: 50, panY: 0 });
    // Dragged 50px right, so the frame looks 50px further left than the centre (100).
    assert.equal(rect.sx, 50);
  });
});

describe("editedName", () => {
  test("marks a file as edited once, with the right extension", () => {
    assert.equal(editedName("face.png", "image/png"), "face-edited.png");
    assert.equal(editedName("face-edited.jpg", "image/jpeg"), "face-edited.jpg");
    assert.equal(editedName("holiday.PNG", "image/jpeg"), "holiday-edited.jpg");
    assert.equal(editedName(undefined), "face-edited.jpg");
  });
});
