/* eslint-disable @typescript-eslint/no-require-imports -- Isolated hook tests use the repository TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const points = [{ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.6 }];
const source = fs.readFileSync(require.resolve("../src/hooks/useNeckTracking.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

function setup(options = {}) {
  let now = 1000, nextId = 0, stateCursor = 0, refCursor = 0, rendered = false, updates = 0;
  const states = [], refs = [], effects = [], timers = new Map(), frames = new Map(), workers = [], canvases = [];
  const tracks = [{ readyState: "live", enabled: true, muted: false }];
  const video = { srcObject: { getVideoTracks: () => tracks }, readyState: 2, paused: false, ended: false,
    videoWidth: 1920, videoHeight: 1080, currentTime: 1 };
  const videoRef = { current: video }, handsRef = { current: [] }, handsUpdatedAtRef = { current: -Infinity };
  const react = {
    useRef: initial => { const i = refCursor++; if (!refs[i]) refs[i] = { current: initial }; return refs[i]; },
    useState: initial => {
      const i = stateCursor++;
      if (!rendered) states[i] = initial;
      return [states[i], next => { updates++; states[i] = typeof next === "function" ? next(states[i]) : next; }];
    },
    useEffect: effect => { if (!rendered) effects.push(effect); },
    useCallback: fn => fn,
  };
  class Worker {
    constructor(url) {
      if (options.workerThrows) throw new Error("worker unavailable");
      this.url = url; this.messages = []; this.terminated = false; workers.push(this);
    }
    postMessage(message, transfer = []) { this.messages.push(structuredClone(message, { transfer })); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  const document = { createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = { width: 0, height: 0, draws: [], getContext: () => ({
      drawImage(...args) { canvas.draws.push(args); now += options.drawDelay ?? 0; },
      getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(Math.round(video.currentTime) % 255) }),
    }) };
    canvases.push(canvas);
    return canvas;
  } };
  const loaded = { exports: {} };
  const timeout = (fn, delay) => { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; };
  const raf = fn => { const id = ++nextId; frames.set(id, fn); return id; };
  new Function("require", "module", "exports", "Worker", "document", "performance", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", outputText)(
    name => { assert.equal(name, "react"); return react; }, loaded, loaded.exports, Worker, document, { now: () => now },
    timeout, id => timers.delete(id), raf, id => frames.delete(id),
  );
  function render() {
    stateCursor = 0; refCursor = 0;
    const result = loaded.exports.useNeckTracking(videoRef, handsRef, handsUpdatedAtRef);
    rendered = true;
    return result;
  }
  let hook = render();
  const cleanup = effects[0]();
  function advance(ms) {
    now += ms;
    for (;;) {
      const due = [...timers].find(([, timer]) => timer.at <= now);
      if (!due) break;
      timers.delete(due[0]); due[1].fn();
    }
  }
  function tick(ms = 0, mediaTime) {
    advance(ms);
    if (mediaTime !== undefined) video.currentTime = mediaTime;
    const pending = [...frames]; frames.clear();
    pending.forEach(([, fn]) => fn(now));
  }
  return {
    get hook() { hook = render(); return hook; }, video, videoRef, tracks, handsRef, handsUpdatedAtRef, workers, canvases, timers, frames,
    get now() { return now; }, get updates() { return updates; },
    advance, tick, cleanup,
    ready() { workers[0].emit({ type: "ready" }); },
    operations() { return workers[0].messages.filter(message => message.type !== "reset"); },
    reply(request, data) { const { epoch, frameId, capturedAt, mediaTime } = request; workers[0].emit({ epoch, frameId, capturedAt, mediaTime, ...data }); },
    startTracking() {
      workers[0].emit({ type: "ready" });
      assert.equal(render().freeze(), true);
      render().seed(points);
      const request = this.operations().at(-1);
      video.currentTime += 0.1;
      this.reply(request, { type: "seeded", status: "tracking", points, inliers: 20 });
      return this.operations().at(-1);
    },
  };
}

test("reset cancels a pending find while the worker is loading", () => {
  const run = setup();
  assert.equal(run.hook.status, "loading");
  assert.equal(run.workers[0].url, "/vision/fretboard-worker.js");
  run.hook.find();
  assert.equal(run.hook.status, "detecting");
  assert.equal(run.operations().length, 0);
  run.hook.reset();
  run.ready();
  assert.equal(run.operations().length, 0);
  assert.equal(run.hook.snapshotRef.current, null);
  assert.equal(run.hook.status, "idle");
  run.cleanup();
});

test("only the latest request survives asynchronous worker startup", () => {
  const run = setup();
  run.hook.find();
  run.video.currentTime = 2;
  run.hook.find();
  run.ready();
  assert.equal(run.operations().length, 1);
  const request = run.operations()[0];
  assert.equal(request.mediaTime, 2);
  run.advance(500);
  run.reply(request, { type: "detected", proposal: { points, wireCount: 8 } });
  assert.equal(run.hook.status, "proposal");
  assert.deepEqual(run.hook.proposal, { points, wireCount: 8 });
  assert.equal(run.hook.poseRef.current, null);
  run.cleanup();
});

test("a pending seed supersedes detection during startup, while a source change cancels it", () => {
  const run = setup();
  run.hook.find();
  run.hook.seed(points);
  run.ready();
  assert.equal(run.operations().length, 1);
  assert.equal(run.operations()[0].type, "seed");
  run.cleanup();

  const changed = setup();
  changed.hook.freeze();
  changed.hook.seed(points);
  changed.video.srcObject = { getVideoTracks: () => changed.tracks };
  changed.ready();
  assert.equal(changed.operations().length, 0);
  assert.equal(changed.hook.snapshotRef.current, null);
  assert.equal(changed.hook.status, "idle");
  changed.cleanup();
});

test("freeze captures an unmirrored immutable snapshot before readback and never publishes its old pose", () => {
  const run = setup({ drawDelay: 20 });
  run.ready();
  const before = run.now;
  assert.equal(run.hook.freeze(), true);
  const snapshot = run.hook.snapshotRef.current;
  assert.equal(snapshot.capturedAt, before);
  assert.equal(snapshot.width, 960);
  assert.equal(snapshot.height, 540);
  assert.deepEqual(snapshot.canvas.draws[0], [run.video, 0, 0, 960, 540]);
  const pixel = snapshot.rgba[0];
  run.advance(60000);
  run.hook.seed(points);
  const seed = run.operations().at(-1);
  assert.equal(seed.capturedAt, before);
  assert.equal(snapshot.rgba.byteLength, 960 * 540 * 4);
  assert.equal(run.hook.snapshotRef.current, snapshot);
  run.video.currentTime = 62;
  run.reply(seed, { type: "seeded", status: "tracking", points, inliers: 20 });
  assert.equal(run.hook.snapshotRef.current, null);
  assert.equal(run.hook.poseRef.current, null);
  assert.equal(run.hook.status, "searching");
  const frame = run.operations().at(-1);
  assert.equal(frame.type, "frame");
  assert.ok(frame.capturedAt > before + 60000);
  assert.notEqual(run.canvases[0], snapshot.canvas);
  assert.equal(snapshot.rgba[0], pixel);
  assert.equal(snapshot.canvas.draws.length, 1);
  run.cleanup();
});

test("tracking drops busy and duplicate video frames instead of building a queue", () => {
  const run = setup();
  const first = run.startTracking();
  assert.equal(first.type, "frame");
  for (let i = 0; i < 3; i++) run.tick(70, 2 + i);
  assert.equal(run.operations().filter(message => message.type === "frame").length, 1);
  run.reply(first, { type: "pose", status: "tracking", points, inliers: 15 });
  run.tick(1, 4);
  const second = run.operations().at(-1);
  assert.equal(second.mediaTime, 4);
  run.reply(second, { type: "pose", status: "tracking", points, inliers: 15 });
  run.tick(70, 4);
  assert.equal(run.operations().at(-1).frameId, second.frameId);
  run.tick(1, 5);
  assert.notEqual(run.operations().at(-1).frameId, second.frameId);
  run.cleanup();
});

test("live pose expires without another reply or animation frame", () => {
  const run = setup();
  const frame = run.startTracking();
  run.reply(frame, { type: "pose", status: "tracking", points, inliers: 15 });
  assert.equal(run.hook.status, "tracking");
  assert.equal(run.hook.poseRef.current.capturedAt, frame.capturedAt);
  run.advance(251);
  assert.equal(run.hook.poseRef.current, null);
  assert.equal(run.hook.status, "searching");
  run.cleanup();
});

test("stale, mismatched and old-epoch replies cannot revive a pose", () => {
  const run = setup();
  const first = run.startTracking();
  run.advance(251);
  run.reply(first, { type: "pose", status: "tracking", points, inliers: 15 });
  assert.equal(run.hook.poseRef.current, null);
  run.tick(70, 2);
  const second = run.operations().at(-1);
  run.reply(first, { type: "pose", status: "tracking", points, inliers: 15 });
  assert.equal(run.hook.poseRef.current, null);
  run.reply(second, { type: "pose", status: "tracking", points, capturedAt: second.capturedAt + 1 });
  assert.equal(run.hook.poseRef.current, null);
  run.tick(70, 3);
  const third = run.operations().at(-1);
  run.hook.reset();
  run.reply(third, { type: "pose", status: "tracking", points, inliers: 15 });
  assert.equal(run.hook.poseRef.current, null);
  assert.equal(run.hook.status, "idle");
  run.cleanup();
});

test("a new explicit find waits for an obsolete in-flight request and keeps only its own result", () => {
  const run = setup();
  run.ready();
  run.hook.find();
  const first = run.operations()[0];
  run.video.currentTime = 2;
  run.hook.find();
  assert.equal(run.operations().length, 1);
  run.reply(first, { type: "detected", proposal: { points, wireCount: 8 } });
  assert.equal(run.hook.proposal, null);
  assert.equal(run.operations().length, 2);
  const second = run.operations()[1];
  assert.notEqual(first.epoch, second.epoch);
  run.reply(second, { type: "detected", proposal: null });
  assert.match(run.hook.error, /No clear fretboard/);
  assert.equal(run.hook.status, "idle");
  run.cleanup();
});

test("source objects, track identities, dimensions, and ended tracks invalidate tracking", () => {
  for (const change of [
    run => { run.video.srcObject = { getVideoTracks: () => run.tracks }; },
    run => { run.tracks[0] = { readyState: "live", enabled: true, muted: false }; },
    run => { run.video.videoWidth = 1280; },
    run => { run.tracks[0].readyState = "ended"; },
  ]) {
    const run = setup();
    const frame = run.startTracking();
    change(run);
    run.tick(1, 2);
    run.reply(frame, { type: "pose", status: "tracking", points, inliers: 15 });
    assert.equal(run.hook.poseRef.current, null);
    assert.equal(run.hook.snapshotRef.current, null);
    assert.equal(run.hook.status, "idle");
    assert.match(run.hook.error, /camera changed or stopped/i);
    run.cleanup();
  }
});

test("hand exclusions use the frame's fresh observations and remain aligned with a frozen seed", () => {
  const run = setup();
  run.ready();
  run.handsRef.current = [{ landmarks: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }] }];
  run.handsUpdatedAtRef.current = run.now;
  run.hook.freeze();
  run.advance(1000);
  run.handsRef.current = [{ landmarks: [{ x: 0.8, y: 0.9 }] }];
  run.handsUpdatedAtRef.current = run.now;
  run.hook.seed(points);
  const seed = run.operations().at(-1);
  assert.equal(seed.exclusions.length, 1);
  assert.ok(Math.abs(seed.exclusions[0].x - 0.17) < 1e-12);
  assert.ok(Math.abs(seed.exclusions[0].width - 0.26) < 1e-12);
  run.video.currentTime = 2;
  run.handsUpdatedAtRef.current = run.now - 251;
  run.reply(seed, { type: "seeded", status: "tracking", points, inliers: 20 });
  assert.deepEqual(run.operations().at(-1).exclusions, []);
  run.cleanup();
});

test("operation failures can retry, while setup failures and timeouts terminate truthfully", () => {
  const run = setup();
  run.ready();
  run.hook.freeze();
  run.hook.seed(points);
  run.reply(run.operations().at(-1), { type: "error", message: "Not enough visible neck detail to track." });
  assert.equal(run.hook.status, "error");
  assert.equal(run.hook.poseRef.current, null);
  assert.equal(run.workers[0].terminated, false);
  run.hook.find();
  assert.equal(run.hook.status, "detecting");
  run.advance(5000);
  assert.equal(run.workers[0].terminated, true);
  assert.equal(run.hook.status, "error");
  assert.match(run.hook.error, /timed out/);
  run.cleanup();

  const loading = setup();
  loading.advance(15000);
  assert.equal(loading.workers[0].terminated, true);
  assert.match(loading.hook.error, /finish loading/);
  loading.cleanup();
  const unavailable = setup({ workerThrows: true });
  assert.equal(unavailable.hook.status, "error");
  assert.match(unavailable.hook.error, /Web Worker/);
  unavailable.cleanup();
});

test("unmount terminates the worker, clears resources and ignores late callbacks", () => {
  const run = setup();
  const frame = run.startTracking();
  run.cleanup();
  const updates = run.updates;
  assert.equal(run.workers[0].terminated, true);
  assert.equal(run.timers.size, 0);
  assert.equal(run.frames.size, 0);
  run.reply(frame, { type: "pose", status: "tracking", points, inliers: 15 });
  run.advance(20000);
  assert.equal(run.updates, updates);
  assert.equal(run.hook.poseRef.current, null);
  assert.equal(run.hook.snapshotRef.current, null);
  assert.equal(run.hook.freeze(), false);
});
