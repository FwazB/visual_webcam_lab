/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the classic worker module with actual OpenCV. */
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const cv = require("@techstark/opencv-js");
const { detectNeck } = require("../public/vision/neck-detector.js");
const { makeNeckImage, warpImage } = require("./fixtures/neck-images.cjs");

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
  const failing = new Proxy(wrapped, { get: (target, key) => key === "Canny" ? () => { throw new Error("test failure"); } : target[key] });
  assert.throws(() => detectNeck(failing, image.rgba, image.width, image.height), /test failure/);
  assert.equal(allocated, deleted);
});
