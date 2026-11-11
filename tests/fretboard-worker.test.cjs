/* eslint-disable @typescript-eslint/no-require-imports -- Executes the actual classic worker and pinned WASM without a browser. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeNeckImage, warpImage } = require("./fixtures/neck-images.cjs");

test("classic worker loads same-origin WASM and rejects malformed or obsolete frames", { timeout: 15000 }, async () => {
  const headers = await require("../next.config.ts").default.headers();
  const policy = headers.find(rule => rule.source === "/vision/fretboard-worker.js").headers
    .find(header => header.key === "Content-Security-Policy").value;
  const documentPolicy = headers.find(rule => rule.source === "/(.*)").headers
    .find(header => header.key === "Content-Security-Policy").value;
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(documentPolicy, /'unsafe-eval'/, "worker code generation must not weaken the page");
  const directory = path.join(__dirname, "../public/vision");
  const messages = [];
  const imports = [];
  let notify;
  const firstMessage = new Promise(resolve => { notify = resolve; });
  const context = vm.createContext({
    console, performance, TextDecoder, TextEncoder, setTimeout, clearTimeout, atob, btoa,
    ArrayBuffer, Uint8Array, Uint8ClampedArray,
    location: { href: "https://local.example/vision/fretboard-worker.js" },
    postMessage(message) { messages.push(message); notify(); },
  }, { codeGeneration: { strings: policy.includes("'unsafe-eval'"), wasm: policy.includes("'unsafe-eval'") || policy.includes("'wasm-unsafe-eval'") } });
  context.self = context;
  context.importScripts = (...urls) => {
    for (const url of urls) {
      assert.ok(["./opencv-4.12.0.js", "./neck-tracker.js", "./neck-detector.js"].includes(url));
      imports.push(url);
      vm.runInContext(fs.readFileSync(path.join(directory, url), "utf8"), context, { filename: url });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(directory, "fretboard-worker.js"), "utf8"), context);
  await firstMessage;
  assert.equal(messages[0].type, "ready", JSON.stringify(messages[0]));
  assert.equal(imports.length, 3);
  context.onmessage({ data: { type: "reset", epoch: 3 } });
  const invalid = { type: "frame", epoch: 3, frameId: 7, capturedAt: 12, mediaTime: 0.1, width: 640, height: 400, rgba: new ArrayBuffer(8) };
  context.onmessage({ data: { ...invalid, epoch: 2 } });
  assert.equal(messages.length, 1, "old reference messages are ignored");
  context.onmessage({ data: invalid });
  assert.equal(messages[1].type, "error");
  assert.equal(messages[1].frameId, 7);
  assert.equal(messages[1].capturedAt, 12, "timestamps are not replaced by worker completion time");
  assert.equal(messages[1].epoch, 3);
  const visibleNeck = makeNeckImage({ texture: false });
  const expectedProposal = context.NeckDetector.detectNeck(context.cv, visibleNeck.rgba, visibleNeck.width, visibleNeck.height);
  context.onmessage({ data: {
    type: "detect", epoch: 3, frameId: 8, capturedAt: 24, mediaTime: .2,
    width: visibleNeck.width, height: visibleNeck.height, rgba: visibleNeck.rgba.buffer,
  } });
  const detected = messages.at(-1);
  assert.equal(detected.type, "detected");
  assert.equal(detected.epoch, 3);
  assert.equal(detected.frameId, 8);
  assert.equal(detected.capturedAt, 24);
  assert.equal(detected.mediaTime, .2);
  assert.ok(detected.proposal.frets.length > 7, "the worker must retain the whole observed fret sequence");
  assert.equal(detected.proposal.frets.length, detected.proposal.wireCount);
  assert.deepEqual(detected.proposal, expectedProposal, "fret coordinates and ordering pass through the worker unchanged");
  const reference = makeNeckImage();
  context.onmessage({ data: {
    type: "seed", epoch: 4, frameId: 8, capturedAt: 30, mediaTime: .3,
    width: reference.width, height: reference.height, rgba: reference.rgba.buffer,
    points: reference.normalizedPoints,
  } });
  assert.equal(messages.at(-1).type, "seeded");
  assert.equal(messages.at(-1).status, "tracking");
  const destination = reference.points.map(point => ({ x: point.x + 16, y: point.y - 8 }));
  const moved = warpImage(context.cv, reference, destination);
  context.onmessage({ data: {
    type: "frame", epoch: 4, frameId: 9, capturedAt: 500, mediaTime: .5,
    width: moved.width, height: moved.height, rgba: moved.rgba.buffer,
  } });
  const pose = messages.at(-1);
  assert.equal(pose.type, "pose");
  assert.equal(pose.status, "tracking");
  assert.equal(pose.capturedAt, 500);
  pose.points.forEach((point, i) => {
    assert.ok(Math.hypot(point.x * moved.width - destination[i].x, point.y * moved.height - destination[i].y) < 4);
  });
  // A healthy short reference must expand when the rest of the same neck is
  // visible; ORB alone would keep this cropped rectangle indefinitely.
  const partial = reference.normalizedPoints.map((point, i) => ({ ...point, x: i < 2 ? .4 : point.x }));
  context.onmessage({ data: { type: "seed", epoch: 5, frameId: 10, capturedAt: 600, mediaTime: .6,
    width: reference.width, height: reference.height, rgba: reference.rgba.buffer, points: partial, wireCount: 6 } });
  assert.equal(messages.at(-1).status, "tracking");
  context.onmessage({ data: { type: "frame", epoch: 5, frameId: 11, capturedAt: 700, mediaTime: .7,
    width: reference.width, height: reference.height, rgba: reference.rgba.buffer, refresh: true } });
  const expanded = messages.at(-1);
  assert.equal(expanded.type, "pose");
  assert.equal(expanded.status, "tracking");
  assert.ok(expanded.replacement?.wireCount >= 10, "the real detector supplies additional observed frets");
  assert.ok(Math.min(...expanded.points.map(point => point.x)) < .15, "the new reference covers the upper neck");
  context.onmessage({ data: { type: "frame", epoch: 5, frameId: 12, capturedAt: 800, mediaTime: .8,
    width: reference.width, height: reference.height, rgba: reference.rgba.buffer } });
  assert.equal(messages.at(-1).status, "tracking");
  assert.ok(Math.min(...messages.at(-1).points.map(point => point.x)) < .15, "later ORB frames retain the larger reference");
  const large = makeNeckImage({ width: 960, height: 600 });
  context.onmessage({ data: { type: "seed", epoch: 6, frameId: 13, capturedAt: 900, mediaTime: .9,
    width: large.width, height: large.height, rgba: large.rgba.buffer, points: partial, wireCount: 6 } });
  assert.equal(messages.at(-1).status, "tracking");
  let coverageSize;
  const detect = context.NeckDetector.detectNeck;
  context.NeckDetector.detectNeck = (runtime, rgba, width, height) => {
    coverageSize = [width, height];
    return detect(runtime, rgba, width, height);
  };
  context.onmessage({ data: { type: "frame", epoch: 6, frameId: 14, capturedAt: 1000, mediaTime: 1,
    width: large.width, height: large.height, rgba: large.rgba.buffer, refresh: true } });
  assert.deepEqual(coverageSize, [640, 400], "the first periodic search tries a different sampling resolution");
  assert.ok(messages.at(-1).replacement?.wireCount >= 10, "normalized discovery expands the full-resolution reference");
  context.onmessage({ data: { type: "frame", epoch: 6, frameId: 15, capturedAt: 1100, mediaTime: 1.1,
    width: large.width, height: large.height, rgba: large.rgba.buffer } });
  assert.equal(messages.at(-1).status, "tracking", "the live tracker retains full-resolution descriptors");
  context.onmessage({ data: { type: "frame", epoch: 6, frameId: 16, capturedAt: 6100, mediaTime: 6.1,
    width: large.width, height: large.height, rgba: large.rgba.buffer, refresh: true } });
  assert.deepEqual(coverageSize, [960, 600], "the next periodic search preserves the original fine detail");
  assert.equal(messages.at(-1).replacement, undefined, "the current full region is not repeatedly reseeded");
  context.onmessage({ data: { type: "reset", epoch: 7 } });
});

function coverageWorker(options = {}) {
  const oldPoints = [{ x: .35, y: .4 }, { x: .35, y: .5 }, { x: .75, y: .4 }, { x: .75, y: .5 }];
  const widerPoints = [{ x: .1, y: .4 }, { x: .1, y: .5 }, { x: .9, y: .4 }, { x: .9, y: .5 }];
  const state = { messages: [], trackers: [], detections: 0, detectionSizes: [], oldPoints, widerPoints,
    proposal: { points: widerPoints, wireCount: 16, frets: [] }, ...options };
  class Tracker {
    constructor() { this.id = state.trackers.length; this.points = oldPoints; state.trackers.push(this); }
    reset() { this.points = null; }
    dispose() { this.disposed = true; }
    seed(_rgba, _width, _height, points) {
      if (state.seedFails && this.id > 0) return { status: "lost", points: null };
      this.points = points;
      return { status: "tracking", points, inliers: 30 };
    }
    update() { return { status: state.lost ? "lost" : "tracking", points: this.points, inliers: 30 }; }
  }
  const context = vm.createContext({ ArrayBuffer, Uint8ClampedArray,
    cv: options.runtime ?? { Mat: true, ORB: true, findHomography: true }, NeckTracker: Tracker,
    NeckDetector: { detectNeck(_cv, _rgba, width, height) {
      state.detections++; state.detectionSizes.push([width, height]);
      if (state.detectThrows) throw new Error("optional detector failed"); return state.proposal;
    } },
    importScripts() {}, postMessage(message) { state.messages.push(message); } });
  context.self = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/vision/fretboard-worker.js"), "utf8"), context);
  let frameId = 0;
  const width = options.width ?? 320, height = options.height ?? 200;
  const send = (data) => {
    context.onmessage({ data: { epoch: 1, frameId: ++frameId, capturedAt: frameId * 100, mediaTime: frameId / 10,
      width, height, rgba: new ArrayBuffer(width * height * 4), ...data } });
    return state.messages.at(-1);
  };
  send({ type: "seed", points: oldPoints, wireCount: 8 });
  return { state, send };
}

test("coverage refresh atomically replaces only a larger compatible reference", () => {
  const { state, send } = coverageWorker();
  const refreshed = send({ type: "frame", refresh: true });
  assert.equal(refreshed.status, "tracking");
  assert.equal(refreshed.replacement, state.proposal);
  assert.equal(refreshed.points, state.widerPoints);
  assert.equal(state.trackers[0].disposed, true);
  assert.equal(state.trackers[1].disposed, undefined);
  const next = send({ type: "frame" });
  assert.equal(next.points, state.widerPoints);
  assert.equal(next.replacement, undefined);
  assert.equal(state.detections, 1, "ordinary frames do not repeat detection");
});

test("refresh misses, unrelated patterns and failed candidate seeds preserve live tracking", () => {
  for (const kind of ["miss", "same", "sideways", "tooWide", "fewWires", "seedFails", "detectThrows"]) {
    const { state, send } = coverageWorker();
    if (kind === "miss") state.proposal = null;
    if (kind === "same") state.proposal.points = state.oldPoints;
    if (kind === "sideways") state.proposal.points = state.widerPoints.map(p => ({ ...p, y: p.y + .2 }));
    if (kind === "tooWide") state.proposal.points = state.widerPoints.map((p, i) => ({ ...p, y: i % 2 ? .6 : .3 }));
    if (kind === "fewWires") state.proposal.wireCount = 9;
    if (kind === "seedFails") state.seedFails = true;
    if (kind === "detectThrows") state.detectThrows = true;
    const refreshed = send({ type: "frame", refresh: true });
    assert.equal(refreshed.status, "tracking", kind);
    assert.equal(refreshed.points, state.oldPoints, kind);
    assert.equal(refreshed.replacement, undefined, kind);
    assert.equal(state.trackers[0].disposed, undefined, kind);
    if (kind === "seedFails") assert.equal(state.trackers[1].disposed, true);
    assert.equal(send({ type: "frame" }).points, state.oldPoints, kind);
  }
});

test("lost tracking skips optional coverage search", () => {
  const { state, send } = coverageWorker({ lost: true });
  assert.equal(send({ type: "frame", refresh: true }).status, "lost");
  assert.equal(state.detections, 0);
});

function resizingRuntime() {
  const mats = [];
  class Mat {
    constructor(rows = 0, cols = 0) { this.data = new Uint8Array(rows * cols * 4); mats.push(this); }
    delete() { assert.equal(this.deleted, undefined, "each resize buffer is released once"); this.deleted = true; }
  }
  return { mats, Mat, ORB: true, findHomography: true, CV_8UC4: 24, INTER_LINEAR: 1,
    Size: class { constructor(width, height) { this.width = width; this.height = height; } },
    resize(_source, destination, size) { destination.data = new Uint8Array(size.width * size.height * 4); } };
}

test("coverage sampling alternates bounded sizes and resets for a new reference", () => {
  const runtime = resizingRuntime();
  const { state, send } = coverageWorker({ runtime, width: 960, height: 600, proposal: null });
  send({ type: "detect" });
  assert.deepEqual(state.detectionSizes, [[960, 600]], "initial acquisition retains original resolution");
  for (let i = 0; i < 3; i++) send({ type: "frame", refresh: true });
  assert.deepEqual(state.detectionSizes.slice(1), [[640, 400], [960, 600], [640, 400]]);
  assert.equal(runtime.mats.length, 4, "only downsampled attempts allocate resize buffers");
  assert.ok(runtime.mats.every(mat => mat.deleted));
  send({ type: "seed", points: state.oldPoints, wireCount: 8 });
  send({ type: "frame", refresh: true });
  assert.deepEqual(state.detectionSizes.at(-1), [640, 400]);
  send({ type: "reset" });
  // The mock can supply an established pose after reset, allowing the counter
  // reset to be verified independently of the required real seed operation.
  state.trackers[0].points = state.oldPoints;
  send({ type: "frame", refresh: true });
  assert.deepEqual(state.detectionSizes.at(-1), [640, 400]);
  assert.ok(runtime.mats.every(mat => mat.deleted));
  assert.equal(state.trackers[0].disposed, undefined, "unsuccessful size probes retain the working tracker");
});

test("resize buffers are released if optional detection or resizing fails", () => {
  for (const failAt of ["detect", "resize"]) {
    const runtime = resizingRuntime();
    if (failAt === "resize") runtime.resize = () => { throw new Error("resize failed"); };
    const { state, send } = coverageWorker({ runtime, width: 960, height: 600, detectThrows: failAt === "detect" });
    const result = send({ type: "frame", refresh: true });
    assert.equal(result.status, "tracking");
    assert.equal(result.points, state.oldPoints);
    assert.equal(runtime.mats.length, 2);
    assert.ok(runtime.mats.every(mat => mat.deleted), failAt);
    assert.equal(state.trackers[0].disposed, undefined);
  }
});
