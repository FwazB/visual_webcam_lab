/* eslint-disable @typescript-eslint/no-require-imports -- Real OpenCV/WASM tests on generated images, without cameras or browsers. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const cv = require("@techstark/opencv-js");
const { NeckTracker } = require("../public/vision/neck-tracker.js");
const { makeNeckImage, warpImage, cover } = require("./fixtures/neck-images.cjs");

before(async () => {
  // This build is a self-resolving thenable, so await cv/resolve(cv) would loop.
  await new Promise((resolve) => {
    if (cv.Mat) resolve();
    else cv.onRuntimeInitialized = () => resolve();
  });
});

function seed(tracker, image, exclusions) {
  const result = tracker.seed(image.rgba, image.width, image.height, image.normalizedPoints, exclusions);
  assert.equal(result.status, "tracking");
  assert.ok(result.inliers >= 18);
  return result;
}

function nearCorners(result, expected, maxErrorPx = 4) {
  assert.notEqual(result.status, "lost");
  assert.equal(result.points.length, 4);
  result.points.forEach((point, i) => {
    const error = Math.hypot(point.x * expected.width - expected.points[i].x, point.y * expected.height - expected.points[i].y);
    assert.ok(error <= maxErrorPx, `corner ${i} error ${error.toFixed(2)}px exceeds ${maxErrorPx}px`);
  });
}

function blank(image) {
  return cover(image, { x: 0, y: 0, width: image.width, height: image.height }, [24, 24, 24]);
}

function repetitiveGrid(image) {
  const result = blank(image);
  for (let y = 135; y <= 265; y++) {
    for (let x = 35; x <= 605; x++) {
      const light = (x - 35) % 38 < 2 || (y - 135) % 22 < 2;
      result.rgba.set(light ? [220, 220, 220, 255] : [75, 55, 35, 255], (y * result.width + x) * 4);
    }
  }
  return result;
}

test("tracker exposes the same constructor to CommonJS and a classic worker global", () => {
  const worker = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/vision/neck-tracker.js"), "utf8"), worker);
  assert.equal(typeof worker.NeckTracker, "function");
  assert.equal(typeof NeckTracker, "function");
});

test("real ORB/RANSAC follows translation, rotation, scale and mild perspective without reference drift", () => {
  const reference = makeNeckImage();
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference);
    const angle = 10 * Math.PI / 180;
    const transforms = [
      reference.points.map((p) => ({ x: p.x + 14, y: p.y - 24 })),
      reference.points.map((p) => ({ x: 320 + (p.x - 320) * Math.cos(angle) - (p.y - 200) * Math.sin(angle), y: 200 + (p.x - 320) * Math.sin(angle) + (p.y - 200) * Math.cos(angle) })),
      reference.points.map((p) => ({ x: 320 + (p.x - 320) * 0.88, y: 200 + (p.y - 200) * 0.88 })),
      [{ x: 70, y: 145 }, { x: 65, y: 255 }, { x: 565, y: 135 }, { x: 575, y: 245 }],
    ];
    for (const points of transforms) {
      const image = warpImage(cv, reference, points);
      nearCorners(tracker.update(image.rgba, image.width, image.height), image);
    }
    // Return directly to the original texture; previous transforms never become its template.
    nearCorners(tracker.update(reference.rgba, reference.width, reference.height), reference, 1);
  } finally { tracker.dispose(); }
});

test("partial hand occlusion is excluded from reference and current feature matching", () => {
  const reference = makeNeckImage();
  const initialBox = { x: 150, y: 130, width: 80, height: 140 };
  const initial = cover(reference, initialBox);
  const tracker = new NeckTracker(cv);
  const normalize = (box) => ({ x: box.x / reference.width, y: box.y / reference.height, width: box.width / reference.width, height: box.height / reference.height });
  try {
    seed(tracker, initial, [normalize(initialBox)]);
    const nextBox = { x: 330, y: 130, width: 90, height: 140 };
    const next = cover(reference, nextBox, [165, 105, 78]);
    nearCorners(tracker.update(next.rgba, next.width, next.height, [normalize(nextBox)]), reference, 2);
    const hidden = tracker.update(next.rgba, next.width, next.height, [{ x: 0, y: 0, width: 1, height: 1 }]);
    assert.deepEqual(hidden, { status: "lost", points: null, inliers: 0 });
    const restored = tracker.update(reference.rgba, reference.width, reference.height);
    assert.equal(restored.status, "reacquired");
    nearCorners(restored, reference, 2);
  } finally { tracker.dispose(); }
});

test("blank images, unrelated texture and repeated fret-like grids publish no pose, then reacquire the original", () => {
  const reference = makeNeckImage();
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference);
    for (const image of [blank(reference), makeNeckImage({ seed: 9000 }), repetitiveGrid(reference)]) {
      assert.deepEqual(tracker.update(image.rgba, image.width, image.height), { status: "lost", points: null, inliers: 0 });
    }
    const returning = warpImage(cv, reference, reference.points.map((p) => ({ x: p.x - 10, y: p.y + 25 })));
    const result = tracker.update(returning.rgba, returning.width, returning.height);
    assert.equal(result.status, "reacquired");
    nearCorners(result, returning);
  } finally { tracker.dispose(); }
});

test("a fragment with matches confined to one neck end cannot determine the whole fretboard", () => {
  const reference = makeNeckImage();
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference);
    const sliver = cover(reference, { x: 180, y: 0, width: 460, height: reference.height });
    assert.deepEqual(tracker.update(sliver.rgba, sliver.width, sliver.height), { status: "lost", points: null, inliers: 0 });
  } finally { tracker.dispose(); }
});

test("invalid seeds, dimension changes, reset and idempotent disposal cannot retain stale points", () => {
  const reference = makeNeckImage();
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference);
    assert.equal(tracker.seed(reference.rgba, reference.width, reference.height, [{ x: 0, y: 0 }]).points, null);
    assert.equal(tracker.update(reference.rgba, reference.width, reference.height).points, null);
    seed(tracker, reference);
    const otherSize = makeNeckImage({ width: 320, height: 200 });
    assert.equal(tracker.update(otherSize.rgba, otherSize.width, otherSize.height).points, null);
    tracker.reset();
    assert.equal(tracker.update(reference.rgba, reference.width, reference.height).points, null);
    assert.equal(tracker.seed(blank(reference).rgba, reference.width, reference.height, reference.normalizedPoints).points, null);
  } finally { tracker.dispose(); tracker.dispose(); }
  assert.equal(tracker.update(reference.rgba, reference.width, reference.height).points, null);
});

// Count actual Embind allocations, including each nested match-vector handle.
// The wrappers preserve the real native objects and execute the real algorithms.
function countedRuntime(runtime) {
  const active = new Set();
  const observed = new WeakSet();
  const wrapped = Object.create(runtime);
  function own(value) {
    if (!value || typeof value.delete !== "function" || observed.has(value)) return value;
    observed.add(value);
    active.add(value);
    const release = value.delete.bind(value);
    value.delete = () => {
      assert.ok(active.delete(value), "native handle is released exactly once");
      release();
    };
    if (typeof value.get === "function") {
      const get = value.get.bind(value);
      value.get = (...args) => own(get(...args));
    }
    return value;
  }
  for (const name of ["Mat", "KeyPointVector", "DMatchVectorVector", "ORB", "BFMatcher"]) {
    wrapped[name] = function (...args) { return own(new runtime[name](...args)); };
  }
  for (const name of ["matFromArray", "getPerspectiveTransform", "findHomography"]) {
    wrapped[name] = (...args) => own(runtime[name](...args));
  }
  return { runtime: wrapped, active };
}

test("all native allocations and nested match vectors release on success, loss, reset and inference failure", () => {
  const reference = makeNeckImage();
  const counted = countedRuntime(cv);
  const tracker = new NeckTracker(counted.runtime);
  try {
    seed(tracker, reference);
    nearCorners(tracker.update(reference.rgba, reference.width, reference.height), reference);
    assert.equal(counted.active.size, 3, "only ORB, matcher and immutable reference descriptors remain");
    tracker.update(blank(reference).rgba, reference.width, reference.height);
    assert.equal(counted.active.size, 3);
    tracker.reset();
    assert.equal(counted.active.size, 2, "reset releases the reference descriptors");
    seed(tracker, reference);
    tracker.orb.detectAndCompute = () => { throw new Error("inference failed"); };
    assert.throws(() => tracker.update(reference.rgba, reference.width, reference.height), /inference failed/);
    assert.equal(counted.active.size, 3, "failure releases all partially constructed frame resources");
  } finally { tracker.dispose(); }
  assert.equal(counted.active.size, 0);
});
