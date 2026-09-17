/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { detectNeck } = require("../src/lib/neck/detect.ts");
const { findFretRun } = require("../src/lib/neck/acquire.ts");
const { renderSyntheticNeck } = require("../src/lib/neck/dev/synthetic.ts");
const { GUITAR_STANDARD } = require("../src/lib/instrument/profile.ts");
const { createTrackState, updateNeckTrack } = require("../src/lib/neck/track.ts");

function detect(frame, overrides = {}) {
  return detectNeck(frame, { profile: GUITAR_STANDARD, hand: null, prevModel: null, now: 0, ...overrides });
}

function matchesBoard(scene, observation) {
  const model = observation.model;
  assert.ok(model, observation.reason);
  assert.ok(model.confidence >= 0.5);
  assert.ok(model.assignedWires.length >= 6);
  const expected = scene.params.angle;
  const direction = model.dir.x * Math.cos(expected) + model.dir.y * Math.sin(expected);
  assert.ok(direction > Math.cos(3 * Math.PI / 180), "nut-to-bridge axis follows the visible board");
  const point = scene.wireAt(8);
  const dx = point.x - model.origin.x, dy = point.y - model.origin.y;
  const t = dx * model.dir.x + dy * model.dir.y;
  const s = dx * model.normal.x + dy * model.normal.y;
  const top = model.topEdge.s0 + model.topEdge.slope * t;
  const bottom = model.bottomEdge.s0 + model.bottomEdge.slope * t;
  assert.ok(s >= top - 5 && s <= bottom + 5, "detected band covers the real fretboard center");
}

test("acquires dark and maple fretboards without a visible fretting hand", () => {
  for (const angle of [0.38, Math.PI - 0.38]) {
    for (const maple of [false, true]) {
      const scene = renderSyntheticNeck({
        handFrets: null, angle, nut: { x: angle < Math.PI / 2 ? 70 : 890, y: 160 },
        boardGray: maple ? 190 : 40, wireGray: maple ? 60 : 190,
        inlayGray: maple ? 35 : 200, noise: 6,
      });
      matchesBoard(scene, detect(scene.frame));
    }
  }
});

test("image acquisition includes horizontal and steeply diagonal necks", () => {
  for (const params of [
    { angle: 0, nut: { x: 70, y: 260 } },
    { angle: 1.15, nut: { x: 200, y: 50 }, B: 700 },
  ]) {
    const scene = renderSyntheticNeck({ ...params, handFrets: null });
    matchesBoard(scene, detect(scene.frame));
  }
});

test("untracked hand occlusion does not prevent image acquisition", () => {
  const scene = renderSyntheticNeck({ handFrets: [5, 8] });
  matchesBoard(scene, detect(scene.frame));
});

test("the existing hand-guided path still works without an image scan", () => {
  const scene = renderSyntheticNeck();
  const debug = {};
  const observation = detect(scene.frame, { hand: scene.hand, debug });
  matchesBoard(scene, observation);
  assert.equal(debug.acquisitionSeeds, undefined);
});

test("a prior outside the current frame can be reacquired from the image", () => {
  const scene = renderSyntheticNeck({ handFrets: null });
  const initial = detect(scene.frame).model;
  assert.ok(initial);
  const badPrior = { ...initial, origin: { x: -5000, y: -5000 }, dir: { x: 1, y: 0 }, confidence: 0.9 };
  matchesBoard(scene, detect(scene.frame, { prevModel: badPrior }));
});

test("image acquisition enters tracking after repeated consistent observations", () => {
  const scene = renderSyntheticNeck({ handFrets: null });
  const state = createTrackState();
  for (let tick = 0; tick < 4; tick++) {
    const observation = detect(scene.frame, { prevModel: state.model, now: tick * 250 });
    updateNeckTrack(state, observation, tick * 250);
  }
  assert.equal(state.status, "tracking");
  matchesBoard(scene, { model: state.model });
});

test("blank, noisy, evenly striped, and grid frames do not create a neck", () => {
  const width = 640, height = 360;
  for (const kind of ["flat", "noise", "stripes", "grid"]) {
    const data = new Uint8ClampedArray(width * height * 4);
    let random = 1234;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        random = (Math.imul(random, 1664525) + 1013904223) | 0;
        const value = kind === "flat" ? 100 : kind === "noise" ? 80 + ((random >>> 24) % 80)
          : kind === "stripes" ? (x % 30 < 4 ? 40 : 190) : (x % 50 < 4 || y % 35 < 4 ? 40 : 190);
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = value;
        data[index + 3] = 255;
      }
    }
    assert.equal(detect({ data, width, height }).model, null, kind);
  }
});

test("the acquisition prefilter distinguishes fret taper from regular bars", () => {
  const wires = (positions) => positions.map((t) => ({ t, strength: 1, thicknessPx: 2 }));
  const frets = Array.from({ length: 10 }, (_, n) => 900 * (1 - 2 ** (-n / 12)));
  assert.ok(findFretRun(wires(frets)).wires.length >= 8);
  assert.ok(findFretRun(wires(frets.map((t) => -t))).wires.length >= 8);
  assert.equal(findFretRun(wires(Array.from({ length: 10 }, (_, n) => n * 30))).score, 0);
});
