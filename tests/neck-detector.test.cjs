/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the classic worker module with actual OpenCV. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const cv = require("@techstark/opencv-js");
const { detectNeck } = require("../public/vision/neck-detector.js");
const { makeNeckImage, warpImage, cover } = require("./fixtures/neck-images.cjs");

before(async () => {
  if (!cv.Mat) await new Promise((resolve) => { cv.onRuntimeInitialized = () => resolve(); });
});

function distanceToLine(point, a, b) {
  return Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
}

function checkProposal(image, proposal) {
  assert.ok(proposal, "expected supported neck outline");
  assert.ok(proposal.wireCount >= 6);
  assert.equal(proposal.points.length, 4);
  assert.equal(proposal.frets.length, proposal.wireCount);
  assert.deepEqual([proposal.frets[0].a, proposal.frets[0].b, proposal.frets.at(-1).a, proposal.frets.at(-1).b], proposal.points);
  for (const [side, key] of ["a", "b"].entries()) {
    const start = proposal.points[side], end = proposal.points[side + 2];
    const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy;
    let previous = -Infinity;
    for (const fret of proposal.frets) {
      const p = fret[key];
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
      assert.ok(distanceToLine(p, start, end) < 1e-6, "each observed wire is trimmed to the same outer-string rail");
      const progress = ((p.x - start.x) * dx + (p.y - start.y) * dy) / squared;
      assert.ok(progress >= -1e-6 && progress <= 1 + 1e-6 && progress > previous, "wire order stays inside the detected neck");
      previous = progress;
    }
  }
  for (const point of proposal.points) {
    assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  }
  const corners = image.points;
  for (const pair of [[proposal.points[0], proposal.points[2]], [proposal.points[1], proposal.points[3]]]) {
    const pixelPair = pair.map((p) => ({ x: p.x * image.width, y: p.y * image.height }));
    const low = pixelPair.reduce((total, p) => total + distanceToLine(p, corners[0], corners[2]), 0);
    const high = pixelPair.reduce((total, p) => total + distanceToLine(p, corners[1], corners[3]), 0);
    assert.ok(Math.min(low, high) < 14, "proposal side should follow an outer string, not an internal string");
  }
}

function lineImage(kind) {
  const width = 640, height = 400;
  const mat = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(22, 22, 22, 255));
  try {
    const color = new cv.Scalar(215, 215, 215, 255);
    if (kind !== "blank") {
      for (let y = 150; y <= 250; y += 20) cv.line(mat, new cv.Point(60, y), new cv.Point(580, y), color, 2);
    }
    if (kind === "grid") {
      for (let x = 60; x <= 580; x += 40) cv.line(mat, new cv.Point(x, 150), new cv.Point(x, 250), color, 2);
    }
    if (kind === "clutter") {
      let seed = 173;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
      for (let i = 0; i < 110; i++) cv.line(mat,
        new cv.Point(Math.floor(random() * width), Math.floor(random() * height)),
        new cv.Point(Math.floor(random() * width), Math.floor(random() * height)), color, 1);
    }
    return { width, height, rgba: new Uint8ClampedArray(mat.data) };
  } finally { mat.delete(); }
}

test("finds an unequal-fret six-string neck from image pixels", () => {
  const image = makeNeckImage({ texture: false });
  checkProposal(image, detectNeck(cv, image.rgba, image.width, image.height));
});

test("returns every supported visible wire beyond seven, retaining observed positions when mirrored", () => {
  const base = makeNeckImage({ texture: false, lastFret: 16 });
  const flipped = warpImage(cv, base, base.points.map(p => ({ x: base.width - 1 - p.x, y: p.y })));
  for (const [image, mirrored] of [[base, false], [flipped, true]]) {
    const proposal = detectNeck(cv, image.rgba, image.width, image.height);
    checkProposal(image, proposal);
    assert.equal(proposal.wireCount, 17, "all seventeen drawn wires remain available without a seven-fret cap");
    for (const [i, fret] of proposal.frets.entries()) {
      const expected = base.points[0].x + (base.points[2].x - base.points[0].x)
        * (1 - 2 ** (-i / 12)) / (1 - 2 ** (-16 / 12));
      for (const p of [fret.a, fret.b]) {
        const x = mirrored ? base.width - 1 - p.x * base.width : p.x * base.width;
        assert.ok(Math.abs(x - expected) < 3, "reported wire must coincide with a drawn fret, in sensor coordinates");
      }
    }
  }
});

test("finds four bass strings without treating adjacent wood borders as extra strings", () => {
  const image = makeNeckImage({ texture: false, stringCount: 4 });
  checkProposal(image, detectNeck(cv, image.rgba, image.width, image.height));
});

test("finds rotated and perspective neck proposals without assuming fret numbers", () => {
  const base = makeNeckImage({ texture: false });
  for (const points of [
    [{ x: 80, y: 225 }, { x: 110, y: 315 }, { x: 550, y: 65 }, { x: 580, y: 155 }],
    [{ x: 65, y: 150 }, { x: 65, y: 250 }, { x: 575, y: 172 }, { x: 575, y: 244 }],
  ]) {
    const image = warpImage(cv, base, points);
    checkProposal(image, detectNeck(cv, image.rgba, image.width, image.height));
  }
});

test("narrow faint-string necks use fret ridges but keep corners on the outer strings", () => {
  const base = makeNeckImage({ texture: false, stringColor: [105, 100, 90] });
  for (const span of [40, 60]) {
    const image = warpImage(cv, base, [
      { x: 100, y: 200 - span / 2 }, { x: 100, y: 200 + span / 2 },
      { x: 540, y: 200 - span / 2 }, { x: 540, y: 200 + span / 2 },
    ]);
    const proposal = detectNeck(cv, image.rgba, image.width, image.height);
    checkProposal(image, proposal);
    assert.equal(proposal.frets.length, base.lastFret + 1, "ridge fallback retains all supported wires beyond seven");
    for (const [i, fret] of proposal.frets.entries()) {
      const expected = 100 + 440 * (1 - 2 ** (-i / 12)) / (1 - 2 ** (-base.lastFret / 12));
      for (const p of [fret.a, fret.b]) {
        assert.ok(Math.abs(p.x * image.width - expected) < 2, "faint-string fallback returns the observed transverse wires");
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = proposal.points[i];
      assert.ok(Math.hypot(p.x * image.width - image.points[i].x, p.y * image.height - image.points[i].y) < 1.5,
        "fret endpoints extend past strings; the proposal must resolve the string rail from pixels");
    }
  }
});

test("fret ridges alone, three visible strings, and a clipped neck do not establish outer string rails", () => {
  const corners = [{ x: 100, y: 170 }, { x: 100, y: 230 }, { x: 540, y: 170 }, { x: 540, y: 230 }];
  const noStrings = warpImage(cv, makeNeckImage({ texture: false, stringCount: 0 }), corners);
  assert.equal(detectNeck(cv, noStrings.rgba, noStrings.width, noStrings.height), null);
  const neck = warpImage(cv, makeNeckImage({ texture: false, stringColor: [105, 100, 90] }), corners);
  const partial = cover(neck, { x: 0, y: 199, width: 640, height: 201 }, [22, 25, 29]);
  assert.equal(detectNeck(cv, partial.rgba, partial.width, partial.height), null);
  assert.equal(detectNeck(cv, neck.rgba.slice(0, 640 * 210 * 4), 640, 210), null);
});

test("fret ridge sequences span short occlusions without drawing the hidden wires", () => {
  const base = makeNeckImage({ texture: false, lastFret: 16, stringColor: [105, 100, 90] });
  const image = warpImage(cv, base, [
    { x: 100, y: 170 }, { x: 100, y: 230 }, { x: 540, y: 170 }, { x: 540, y: 230 },
  ]);
  const at = i => 100 + 440 * (1 - 2 ** (-i / 12)) / (1 - 2 ** (-16 / 12));
  for (const hidden of [[5], [5, 6], [7, 8]]) {
    const left = (at(hidden[0] - 1) + at(hidden[0])) / 2;
    const right = (at(hidden.at(-1)) + at(hidden.at(-1) + 1)) / 2;
    const occluded = cover(image, { x: left, y: 150, width: right - left, height: 100 }, [78, 58, 38]);
    const proposal = detectNeck(cv, occluded.rgba, occluded.width, occluded.height);
    checkProposal(occluded, proposal);
    assert.equal(proposal.wireCount, 17 - hidden.length);
    const visible = Array.from({ length: 17 }, (_, i) => i).filter(i => !hidden.includes(i));
    for (const [i, fret] of proposal.frets.entries()) {
      for (const point of [fret.a, fret.b]) {
        const x = point.x * image.width;
        assert.ok(Math.abs(x - at(visible[i])) < 2, "every output segment corresponds to an actually visible wire");
        assert.ok(x < left || x > right, "no line is invented inside the occlusion");
      }
    }
  }
});

test("an occlusion near the neck end needs two later observed wires to confirm an extension", () => {
  const image = warpImage(cv, makeNeckImage({ texture: false, lastFret: 16, stringColor: [105, 100, 90] }), [
    { x: 100, y: 170 }, { x: 100, y: 230 }, { x: 540, y: 170 }, { x: 540, y: 230 },
  ]);
  const at = i => 100 + 440 * (1 - 2 ** (-i / 12)) / (1 - 2 ** (-16 / 12));
  for (const hidden of [14, 15]) {
    const left = (at(hidden - 1) + at(hidden)) / 2, right = (at(hidden) + at(hidden + 1)) / 2;
    const occluded = cover(image, { x: left, y: 150, width: right - left, height: 100 }, [78, 58, 38]);
    const proposal = detectNeck(cv, occluded.rgba, occluded.width, occluded.height);
    checkProposal(occluded, proposal);
    assert.equal(proposal.wireCount, hidden, "an unconfirmed bridge must roll back to the supported run before it");
    assert.ok(proposal.frets.every(({ a, b }) => a.x * image.width < left && b.x * image.width < left));
  }
});

test("blank, parallel strings alone, equal grid and line clutter do not become fretboards", () => {
  for (const kind of ["blank", "parallel", "grid", "clutter"]) {
    const image = lineImage(kind);
    assert.equal(detectNeck(cv, image.rgba, image.width, image.height), null, kind);
  }
});

test("invalid image inputs are rejected before allocating OpenCV matrices", () => {
  for (const [rgba, width, height] of [[null, 640, 400], [new Uint8ClampedArray(4), 640, 400], [new Uint8ClampedArray(4), 1, 1], [[], NaN, 400], [[], 2000, 400]]) {
    assert.equal(detectNeck(cv, rgba, width, height), null);
  }
});

test("releases every matrix after success, early rejection and OpenCV errors", () => {
  let allocated = 0, deleted = 0;
  const Mat = new Proxy(cv.Mat, {
    construct(Target, args) {
      const mat = new Target(...args);
      allocated++;
      const release = mat.delete.bind(mat);
      mat.delete = () => { deleted++; release(); };
      return mat;
    },
  });
  const wrapped = new Proxy(cv, { get: (target, key) => key === "Mat" ? Mat : target[key] });
  const image = makeNeckImage({ texture: false });
  assert.ok(detectNeck(wrapped, image.rgba, image.width, image.height));
  assert.equal(allocated, deleted);
  const blank = lineImage("blank");
  assert.equal(detectNeck(wrapped, blank.rgba, blank.width, blank.height), null);
  assert.equal(allocated, deleted);
  const faint = warpImage(cv, makeNeckImage({ texture: false, stringColor: [105, 100, 90] }), [
    { x: 100, y: 180 }, { x: 100, y: 220 }, { x: 540, y: 180 }, { x: 540, y: 220 },
  ]);
  assert.ok(detectNeck(wrapped, faint.rgba, faint.width, faint.height));
  assert.equal(allocated, deleted, "fallback inference releases every owned matrix");
  let houghCalls = 0;
  const fallbackFailure = new Proxy(wrapped, { get: (target, key) => key === "HoughLinesP" ? (...args) => {
    if (++houghCalls === 3) throw new Error("ridge inference failed");
    return target.HoughLinesP(...args);
  } : target[key] });
  assert.throws(() => detectNeck(fallbackFailure, faint.rgba, faint.width, faint.height), /ridge inference failed/);
  assert.equal(allocated, deleted, "fallback exceptions release all partially allocated matrices");
  const failing = new Proxy(wrapped, { get: (target, key) => key === "Canny" ? () => { throw new Error("test failure"); } : target[key] });
  assert.throws(() => detectNeck(failing, image.rgba, image.width, image.height), /test failure/);
  assert.equal(allocated, deleted);
});
