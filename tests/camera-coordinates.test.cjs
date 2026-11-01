/* eslint-disable @typescript-eslint/no-require-imports -- Repository test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cameraViewport, imageToCamera, cameraToImage } = require("../src/lib/instrument/cameraCoordinates.ts");

test("mirrored calibration clicks and landmarks agree through resizing and letterboxing", () => {
  const points = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.5, y: 0.5 }];
  for (const [width, height] of [[1280, 600], [320, 520], [740, 740]]) {
    const view = cameraViewport(width, height, 1920, 1080);
    for (const point of points) {
      const clicked = cameraToImage(view, imageToCamera(view, point));
      assert.ok(Math.abs(clicked.x - point.x) < 1e-12);
      assert.ok(Math.abs(clicked.y - point.y) < 1e-12);
    }
    assert.ok(imageToCamera(view, points[0]).x > imageToCamera(view, points[1]).x);
  }
});

test("letterbox margins and unavailable video dimensions cannot become calibration points", () => {
  const view = cameraViewport(320, 520, 1920, 1080);
  assert.equal(cameraToImage(view, { x: 160, y: 10 }), null);
  assert.equal(cameraToImage(view, { x: 160, y: 510 }), null);
  assert.equal(cameraToImage(view, { x: NaN, y: 260 }), null);
  assert.equal(cameraViewport(320, 520, 0, 0), null);
  assert.equal(cameraViewport(0, 520, 1920, 1080), null);
});
