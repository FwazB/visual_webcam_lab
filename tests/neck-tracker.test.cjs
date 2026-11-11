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

test("a narrow neck keeps its feature budget in a heavily textured room with a hand excluded", () => {
  const base = makeNeckImage({ width: 960, height: 540 });
  const points = [{ x: 360, y: 290 }, { x: 360, y: 340 }, { x: 640, y: 290 }, { x: 640, y: 340 }];
  function room(image) {
    const rgba = new Uint8ClampedArray(image.rgba);
    const xs = image.points.map((p) => p.x), ys = image.points.map((p) => p.y);
    const left = Math.min(...xs) - 12, right = Math.max(...xs) + 12;
    const top = Math.min(...ys) - 12, bottom = Math.max(...ys) + 12;
    let state = 17539;
    for (let y = 0; y < image.height; y += 5) for (let x = 0; x < image.width; x += 5) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const color = Math.floor(state / 2 ** 32 * 255);
      for (let dy = 0; dy < 5 && y + dy < image.height; dy++) for (let dx = 0; dx < 5 && x + dx < image.width; dx++) {
        if (x + dx >= left && x + dx <= right && y + dy >= top && y + dy <= bottom) continue;
        rgba.set([color, color, color, 255], ((y + dy) * image.width + x + dx) * 4);
      }
    }
    return { ...image, rgba };
  }
  const reference = room(warpImage(cv, base, points));
  const next = room(warpImage(cv, base, points.map((p) => ({ x: p.x + 8, y: p.y - 6 }))));
  const hand = [{ x: 390 / 960, y: 280 / 540, width: 60 / 960, height: 70 / 540 }];
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference, hand);
    const result = tracker.update(next.rgba, next.width, next.height, hand);
    assert.equal(result.status, "tracking");
    nearCorners(result, next, 2);
  } finally { tracker.dispose(); }
});

test("a large move outside the previous search region uses the original reference anywhere in the frame", () => {
  const reference = makeNeckImage();
  const distant = warpImage(cv, reference, reference.points.map((p) => ({ x: p.x, y: p.y - 110 })));
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference);
    const moved = tracker.update(distant.rgba, distant.width, distant.height);
    assert.equal(moved.status, "tracking", "an internal local miss is not a published loss");
    nearCorners(moved, distant, 2);
    assert.deepEqual(tracker.update(blank(reference).rgba, reference.width, reference.height), { status: "lost", points: null, inliers: 0 });
    const returned = tracker.update(reference.rgba, reference.width, reference.height);
    assert.equal(returned.status, "reacquired");
    nearCorners(returned, reference, 2);
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

test("a long diagonal neck tracks inside a textured room without spending its local feature budget on the background", () => {
  const base = makeNeckImage({ width: 960, height: 540 });
  const points = [{ x: 185, y: 38 }, { x: 150, y: 90 }, { x: 790, y: 440 }, { x: 755, y: 492 }];
  function room(image) {
    const rgba = new Uint8ClampedArray(image.rgba);
    const a = { x: (image.points[0].x + image.points[1].x) / 2, y: (image.points[0].y + image.points[1].y) / 2 };
    const b = { x: (image.points[2].x + image.points[3].x) / 2, y: (image.points[2].y + image.points[3].y) / 2 };
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let state = 17539;
    for (let y = 0; y < image.height; y += 4) for (let x = 0; x < image.width; x += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const color = Math.floor(state / 2 ** 32 * 255);
      for (let oy = 0; oy < 4 && y + oy < image.height; oy++) for (let ox = 0; ox < 4 && x + ox < image.width; ox++) {
        if (Math.abs((x + ox - a.x) * dy - (y + oy - a.y) * dx) / length < 47) continue;
        rgba.set([color, color, color, 255], ((y + oy) * image.width + x + ox) * 4);
      }
    }
    return { ...image, rgba };
  }
  const reference = room(warpImage(cv, base, points));
  const next = room(warpImage(cv, base, points.map(point => ({ x: point.x + 8, y: point.y - 5 }))));
  const hand = [{ x: .36, y: .29, width: .13, height: .25 }];
  const tracker = new NeckTracker(cv);
  try {
    seed(tracker, reference, hand);
    nearCorners(tracker.update(next.rgba, next.width, next.height, hand), next, 3);
  } finally { tracker.dispose(); }
});
