/* eslint-disable @typescript-eslint/no-require-imports -- Repository test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cameraViewport, imageToCamera } = require("../src/lib/instrument/cameraCoordinates.ts");

test("mirrored landmarks preserve their relative positions through resizing and letterboxing", () => {
  const points = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.5, y: 0.5 }];
  for (const [width, height] of [[1280, 600], [320, 520], [740, 740]]) {
    const view = cameraViewport(width, height, 1920, 1080);
    for (const point of points) {
      const screen = imageToCamera(view, point);
      assert.ok(Math.abs((screen.x - view.left) / view.width - (1 - point.x)) < 1e-12);
      assert.ok(Math.abs((screen.y - view.top) / view.height - point.y) < 1e-12);
    }
    assert.ok(imageToCamera(view, points[0]).x > imageToCamera(view, points[1]).x);
  }
});

test("letterboxing keeps camera corners in the image and rejects unavailable dimensions", () => {
  const view = cameraViewport(320, 520, 1920, 1080);
  assert.deepEqual(view, { width: 320, height: 180, left: 0, top: 170 });
  assert.deepEqual(imageToCamera(view, { x: 0, y: 0 }), { x: 320, y: 170 });
  assert.deepEqual(imageToCamera(view, { x: 1, y: 1 }), { x: 0, y: 350 });
  assert.equal(cameraViewport(320, 520, 0, 0), null);
  assert.equal(cameraViewport(0, 520, 1920, 1080), null);
  assert.equal(cameraViewport(320, 520, NaN, 1080), null);
});
