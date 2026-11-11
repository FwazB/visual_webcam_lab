/* eslint-disable @typescript-eslint/no-require-imports -- Isolated hook tests use the repository TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const points = [{ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.3 }, { x: 0.9, y: 0.6 }];
function observedProposal(count = 16) {
  const frets = Array.from({ length: count }, (_, i) => {
    const t = (1 - 0.95 ** i) / (1 - 0.95 ** (count - 1));
    const at = side => ({ x: points[side].x + (points[side + 2].x - points[side].x) * t,
      y: points[side].y + (points[side + 2].y - points[side].y) * t });
    return { a: at(0), b: at(1) };
  });
  return { points: structuredClone(points), wireCount: count, frets };
}
const proposal = observedProposal();
const source = fs.readFileSync(require.resolve("../src/hooks/useNeckTracking.ts"), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

function setup(options = {}) {
  let now = 1000, nextId = 0, stateCursor = 0, refCursor = 0, rendered = false, updates = 0;
  const states = [], refs = [], effects = [], timers = new Map(), frames = new Map(), workers = [], canvases = [], readbacks = [];
  const tracks = [{ readyState: "live", enabled: true, muted: false }];
  const video = { srcObject: { getVideoTracks: () => tracks }, readyState: options.cameraReady === false ? 0 : 2, paused: false, ended: false,
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
      getImageData() {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(Math.round(video.currentTime) % 255);
        readbacks.push(data);
        return { data };
      },
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
    get hook() { hook = render(); return hook; }, video, videoRef, tracks, handsRef, handsUpdatedAtRef, workers, canvases, timers, frames, readbacks,
    get now() { return now; }, get updates() { return updates; },
    advance, tick, cleanup,
    ready() { workers.at(-1).emit({ type: "ready" }); },
    operations() { return workers.at(-1).messages.filter(message => message.type !== "reset"); },
    reply(request, data) { const { epoch, frameId, capturedAt, mediaTime } = request; workers.at(-1).emit({ epoch, frameId, capturedAt, mediaTime, ...data }); },
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
  run.reply(request, { type: "detected", proposal: proposal });
  assert.equal(run.hook.status, "proposal");
  assert.deepEqual(run.hook.proposal, proposal);
  assert.equal(run.hook.poseRef.current, null);
  run.cleanup();
});

test("observed fret segments are copied intact beyond seven without mirroring sensor coordinates", () => {
  const run = setup();
  run.ready();
  run.hook.find();
  const data = observedProposal(21);
  data.points = data.points.map(p => ({ x: 1 - p.x, y: p.y }));
  data.frets = data.frets.map(({ a, b }) => ({ a: { x: 1 - a.x, y: a.y }, b: { x: 1 - b.x, y: b.y } }));
  const expected = structuredClone(data);
  run.reply(run.operations().at(-1), { type: "detected", proposal: data });
  assert.equal(run.hook.status, "proposal");
  assert.deepEqual(run.hook.proposal, expected);
  data.frets[4].a.x = 0;
  data.points[0].x = 0;
  assert.deepEqual(run.hook.proposal, expected, "worker-owned objects cannot change the accepted geometry later");
  run.cleanup();
});

test("malformed, unbounded and unordered worker fret segments never become a proposal", () => {
  const cases = [
    p => { delete p.frets; },
    p => { p.wireCount--; },
    p => { p.wireCount = 2.5; },
    p => Object.assign(p, observedProposal(41)),
    p => { p.frets[3] = null; },
    p => { p.frets[3].a.x = NaN; },
    p => { p.frets[3].b.y = Infinity; },
    p => { p.frets[3].a.x = -0.1; },
    p => { p.frets[3].a.y = 1.1; },
    p => { p.frets[3].b = p.frets[3].a; },
    p => { p.frets[3].a.y += 0.01; },
    p => { [p.frets[3], p.frets[4]] = [p.frets[4], p.frets[3]]; },
    p => { p.frets[3] = p.frets[2]; },
    p => { p.points[0].x += 0.01; },
    p => { p.frets.reverse(); },
    p => {
      [p.points[2], p.points[3]] = [p.points[3], p.points[2]];
      p.frets = p.frets.map(({ a, b }, i) => ({ a: { ...a, y: a.y + 0.3 * i / (p.wireCount - 1) },
        b: { ...b, y: b.y - 0.3 * i / (p.wireCount - 1) } }));
    },
  ];
  for (const corrupt of cases) {
    const run = setup();
    run.ready();
    run.hook.find();
    const data = observedProposal();
    corrupt(data);
    run.reply(run.operations().at(-1), { type: "detected", proposal: data });
    assert.equal(run.hook.proposal, null);
    assert.equal(run.hook.poseRef.current, null);
    assert.equal(run.hook.status, "searching");
    assert.equal(run.hook.error, null);
    run.cleanup();
  }
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
  run.reply(first, { type: "detected", proposal: proposal });
  assert.equal(run.hook.proposal, null);
  assert.equal(run.operations().length, 2);
  const second = run.operations()[1];
  assert.notEqual(first.epoch, second.epoch);
  run.reply(second, { type: "detected", proposal: null });
  assert.equal(run.hook.error, null);
  assert.equal(run.hook.status, "searching");
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
    assert.equal(run.hook.error, null);
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

for (const failure of ["constructor", "load error", "worker error", "load timeout"]) {
  test(`Find restarts after ${failure} and queues detection until the replacement is ready`, () => {
    const options = { workerThrows: failure === "constructor" };
    const run = setup(options);
    if (failure === "load error") run.workers[0].emit({ type: "error", message: "Vision runtime failed." });
    if (failure === "worker error") run.workers[0].onerror();
    if (failure === "load timeout") run.advance(15000);
    assert.equal(run.hook.status, "error");
    const oldWorker = run.workers.at(-1);
    if (oldWorker) assert.equal(oldWorker.terminated, true);
    options.workerThrows = false;

    run.hook.find();
    const replacement = run.workers.at(-1);
    assert.notEqual(replacement, oldWorker);
    assert.equal(run.hook.status, "detecting");
    assert.equal(run.hook.error, null);
    assert.equal(run.operations().length, 0, "detection waits for initialization");
    oldWorker?.emit({ type: "ready" });
    oldWorker?.emit({ type: "error", message: "Late old-worker failure." });
    oldWorker?.onerror();
    assert.equal(run.hook.status, "detecting");
    assert.equal(replacement.terminated, false);
    assert.equal(run.operations().length, 0, "old ready messages cannot initialize the replacement");

    run.ready();
    const request = run.operations().at(-1);
    assert.equal(request.type, "detect");
    run.reply(request, { type: "detected", proposal: proposal });
    assert.equal(run.hook.status, "proposal");
    run.cleanup();
  });
}

test("Find recovers from an operation timeout without accepting the old worker's callbacks", () => {
  const run = setup();
  run.ready();
  run.hook.find();
  const oldWorker = run.workers[0];
  const oldRequest = run.operations().at(-1);
  run.advance(5000);
  assert.equal(oldWorker.terminated, true);
  run.video.currentTime = 2;
  run.hook.find();
  run.ready();
  const replacement = run.workers.at(-1);
  const request = run.operations().at(-1);
  assert.equal(request.type, "detect");
  assert.equal(request.mediaTime, 2);
  assert.notEqual(request.epoch, oldRequest.epoch);
  oldWorker.emit({ ...oldRequest, type: "detected", proposal: proposal });
  oldWorker.emit({ type: "error", message: "Late old-worker failure." });
  oldWorker.onerror();
  assert.equal(replacement.terminated, false);
  assert.equal(run.hook.status, "detecting");
  assert.equal(run.hook.proposal, null);
  run.reply(request, { type: "detected", proposal: proposal });
  assert.equal(run.hook.status, "proposal");
  run.cleanup();
});

test("manual freezing restarts a failed worker and preserves the new snapshot for seeding", () => {
  const run = setup();
  run.ready();
  run.workers[0].onerror();
  assert.equal(run.hook.freeze(), true);
  assert.equal(run.workers.length, 2);
  assert.equal(run.hook.error, null);
  const snapshot = run.hook.snapshotRef.current;
  run.hook.seed(points);
  assert.equal(run.operations().length, 0);
  run.ready();
  const request = run.operations().at(-1);
  assert.equal(request.type, "seed");
  assert.equal(request.capturedAt, snapshot.capturedAt);
  assert.equal(run.hook.snapshotRef.current, snapshot);
  run.reply(request, { type: "seeded", status: "tracking", points, inliers: 20 });
  assert.equal(run.hook.status, "searching");
  run.cleanup();
});

test("a worker failure discards its reference and cannot restart through a late seed", () => {
  for (const sourceChanged of [false, true]) {
    const run = setup();
    run.ready();
    run.hook.freeze();
    run.workers[0].onerror();
    if (sourceChanged) run.video.srcObject = { getVideoTracks: () => run.tracks };
    run.hook.seed(points);
    assert.equal(run.workers.length, 1);
    assert.equal(run.hook.snapshotRef.current, null);
    run.hook.resume();
    assert.equal(run.workers.length, 2);
    run.ready();
    assert.equal(run.operations().length, 0);
    run.tick(1, 2);
    assert.equal(run.operations().at(-1).type, "detect");
    run.cleanup();
  }
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

test("a fresh camera automatically detects, binds its snapshot source, and only publishes a later live pose", () => {
  const run = setup();
  run.video.paused = true;
  run.ready();
  run.tick(100, 2);
  assert.equal(run.operations().length, 0);
  run.video.paused = false;
  run.tick(1, 2.1);
  const detect = run.operations().at(-1);
  assert.equal(detect.type, "detect", "no Find or freeze call is required");
  assert.equal(run.hook.status, "detecting");
  assert.deepEqual(run.hook.snapshotRef.current.camera, { video: run.video, source: run.video.srcObject,
    track: run.tracks[0], width: 1920, height: 1080 });
  run.reply(detect, { type: "detected", proposal });
  run.tick(2000, 4.1);
  assert.equal(run.operations().length, 1, "a proposal awaiting the component never starts another search");
  run.hook.seed(run.hook.proposal.points);
  const seed = run.operations().at(-1);
  assert.equal(seed.type, "seed");
  assert.equal(seed.capturedAt, detect.capturedAt);
  run.reply(seed, { type: "seeded", status: "tracking", points });
  assert.equal(run.hook.poseRef.current, null, "an old detection or seed is never displayed as live geometry");
  const frame = run.operations().at(-1);
  assert.equal(frame.type, "frame");
  assert.equal(frame.mediaTime, 4.1);
  run.reply(frame, { type: "pose", status: "tracking", points });
  assert.deepEqual(run.hook.poseRef.current.points, points);
  run.cleanup();
});

test("automatic misses retry after completion with bounded work and no repeat of an unchanged camera image", () => {
  const run = setup();
  run.ready();
  run.tick();
  const first = run.operations().at(-1);
  for (let i = 1; i <= 10; i++) run.tick(50, 1 + i / 10);
  assert.equal(run.operations().length, 1, "busy detection cannot accumulate frames");
  run.reply(first, { type: "detected", proposal: null });
  assert.equal(run.hook.snapshotRef.current, null);
  assert.equal(run.hook.status, "searching");
  run.tick(1499, 3);
  assert.equal(run.operations().length, 1, "cooldown starts when detection completes");
  run.tick(1, 3.1);
  assert.equal(run.operations().length, 2);
  run.reply(run.operations().at(-1), { type: "detected", proposal: null });
  run.tick(10000, 3.1);
  assert.equal(run.operations().length, 2, "a stalled image is not detected repeatedly");
  run.tick(1, 3.2);
  assert.equal(run.operations().length, 3);
  run.cleanup();
});

test("fresh tracking avoids repeated detection and sustained loss automatically replaces the reference", () => {
  const run = setup();
  let request = run.startTracking();
  for (let i = 0; i < 35; i++) {
    run.reply(request, { type: "pose", status: "tracking", points });
    run.tick(100, 2 + i / 10);
    request = run.operations().at(-1);
    assert.equal(request.type, "frame", "healthy tracking does not rerun the expensive detector");
  }
  run.reply(request, { type: "pose", status: "lost" });
  assert.equal(run.hook.poseRef.current, null);
  run.tick(2999, 6);
  request = run.operations().at(-1);
  assert.equal(request.type, "frame", "the original reference can reacquire during the grace period");
  run.reply(request, { type: "pose", status: "lost" });
  run.tick(1, 6.1);
  request = run.operations().at(-1);
  assert.equal(request.type, "detect");
  assert.equal(run.hook.status, "detecting");
  assert.equal(run.hook.poseRef.current, null);
  run.reply(request, { type: "detected", proposal });
  run.hook.seed(run.hook.proposal.points);
  assert.equal(run.operations().at(-1).type, "seed");
  run.cleanup();
});

test("a fresh reacquired pose clears the loss timer before another loss", () => {
  const run = setup();
  let request = run.startTracking();
  run.reply(request, { type: "pose", status: "lost" });
  run.tick(2900, 2);
  request = run.operations().at(-1);
  run.reply(request, { type: "pose", status: "reacquired", points });
  run.tick(100, 2.1);
  request = run.operations().at(-1);
  assert.equal(request.type, "frame");
  run.reply(request, { type: "pose", status: "lost" });
  run.tick(2999, 5.1);
  assert.equal(run.operations().at(-1).type, "frame");
  run.reply(run.operations().at(-1), { type: "pose", status: "lost" });
  run.tick(1, 5.2);
  assert.equal(run.operations().at(-1).type, "detect");
  run.cleanup();
});

test("pause invalidates late detection and seed replies without disabling the camera", () => {
  for (const pauseAt of ["detect", "seed"]) {
    const run = setup();
    run.ready();
    run.tick();
    let request = run.operations().at(-1);
    if (pauseAt === "seed") {
      run.reply(request, { type: "detected", proposal });
      run.hook.seed(points);
      request = run.operations().at(-1);
    }
    run.hook.pause();
    run.reply(request, pauseAt === "detect" ? { type: "detected", proposal } : { type: "seeded", status: "tracking", points });
    const count = run.operations().length;
    run.tick(20000, 21);
    assert.equal(run.operations().length, count);
    assert.equal(run.hook.status, "paused");
    assert.equal(run.hook.proposal, null);
    assert.equal(run.hook.poseRef.current, null);
    assert.equal(run.tracks[0].enabled, true);
    run.hook.resume();
    run.tick(1, 21.1);
    assert.equal(run.operations().at(-1).type, "detect");
    assert.equal(run.workers.length, 1);
    run.cleanup();
  }
});

test("camera changes restart acquisition on the new source but preserve explicit pause", () => {
  for (const paused of [false, true]) {
    const run = setup();
    run.ready();
    run.tick();
    run.reply(run.operations().at(-1), { type: "detected", proposal: null });
    if (paused) run.hook.pause();
    run.video.srcObject = { getVideoTracks: () => run.tracks };
    run.tick(1, 1);
    assert.equal(run.operations().length, paused ? 1 : 2);
    if (paused) assert.equal(run.hook.status, "paused");
    else assert.equal(run.hook.snapshotRef.current.camera.source, run.video.srcObject);
    run.cleanup();
  }
});

test("terminal failures do not create an automatic worker restart loop", () => {
  const run = setup();
  run.ready();
  run.tick();
  run.workers[0].onerror();
  for (let i = 0; i < 10; i++) run.tick(5000, i + 2);
  assert.equal(run.workers.length, 1);
  assert.equal(run.hook.status, "error");
  assert.equal(run.hook.snapshotRef.current, null);
  run.hook.resume();
  assert.equal(run.workers.length, 2);
  run.ready();
  run.tick(1, 13);
  assert.equal(run.operations().at(-1).type, "detect");
  run.cleanup();
});

test("a timeout after pause cannot resume acquisition or replace the paused UI", () => {
  const run = setup();
  run.ready();
  run.tick();
  run.hook.pause();
  run.tick(5001, 7);
  assert.equal(run.hook.status, "paused");
  assert.equal(run.hook.error, null);
  assert.equal(run.workers[0].terminated, true);
  run.hook.resume();
  assert.equal(run.workers.length, 2);
  run.cleanup();
});

test("OpenCV waits for a usable camera and starts automatic acquisition once video arrives", () => {
  const run = setup({ cameraReady: false });
  assert.equal(run.workers.length, 0, "denied or pending camera permission does not load the vision runtime");
  assert.equal(run.timers.size, 0, "worker startup cannot time out before a camera exists");
  run.tick(30000, 1);
  assert.equal(run.workers.length, 0);
  assert.equal(run.readbacks.length, 0);
  assert.equal(run.hook.error, null);
  run.video.readyState = 2;
  run.tick(1, 1.1);
  assert.equal(run.workers.length, 1);
  assert.equal(run.operations().length, 0);
  run.ready();
  run.tick(1, 1.2);
  assert.equal(run.operations().at(-1).type, "detect");
  assert.equal(run.hook.status, "detecting");
  run.cleanup();
});

test("pausing before camera startup defers the worker until an explicit resume", () => {
  const run = setup({ cameraReady: false });
  run.hook.pause();
  run.video.readyState = 2;
  run.tick(30000, 2);
  assert.equal(run.workers.length, 0);
  assert.equal(run.hook.status, "paused");
  run.hook.resume();
  assert.equal(run.workers.length, 1);
  run.ready();
  run.tick(1, 2.1);
  assert.equal(run.operations().at(-1).type, "detect");
  run.cleanup();
});

test("retry after worker failure waits for a replacement camera without reloading in a loop", () => {
  const run = setup();
  run.ready();
  const oldWorker = run.workers[0];
  oldWorker.onerror();
  run.video.readyState = 0;
  run.hook.resume();
  run.tick(30000, 2);
  assert.equal(run.workers.length, 1);
  assert.equal(run.hook.error, null);
  run.video.readyState = 2;
  run.tick(1, 2.1);
  assert.equal(run.workers.length, 2);
  oldWorker.emit({ type: "ready" });
  assert.equal(run.operations().length, 0);
  run.ready();
  run.tick(1, 2.2);
  assert.equal(run.operations().at(-1).type, "detect");
  run.cleanup();
});

test("live frame buffers transfer ownership while detection and seed snapshots remain intact", () => {
  const run = setup();
  run.ready();
  run.tick();
  const detect = run.operations().at(-1);
  const snapshot = run.hook.snapshotRef.current;
  const snapshotPixels = run.readbacks[0];
  const bytes = 960 * 540 * 4;
  assert.equal(snapshot.rgba, snapshotPixels);
  assert.equal(snapshotPixels.byteLength, bytes);
  assert.equal(detect.rgba.byteLength, bytes);
  run.reply(detect, { type: "detected", proposal });
  run.hook.seed(points);
  const seed = run.operations().at(-1);
  assert.equal(seed.type, "seed");
  assert.equal(snapshotPixels.byteLength, bytes, "seeding transfers a copy of its immutable reference");
  assert.equal(seed.rgba.byteLength, bytes);
  run.video.currentTime = 2;
  run.reply(seed, { type: "seeded", status: "tracking", points });
  const frame = run.operations().at(-1);
  assert.equal(frame.type, "frame");
  assert.equal(run.readbacks.at(-1).byteLength, 0, "a disposable live readback transfers directly instead of allocating a copy");
  assert.equal(frame.rgba.byteLength, bytes);
  assert.equal(new Uint8ClampedArray(frame.rgba)[0], 2);
  assert.equal(snapshotPixels.byteLength, bytes);
  assert.equal(snapshotPixels[0], 1, "later live transfers cannot detach or mutate the original reference");
  run.reply(frame, { type: "pose", status: "tracking", points });
  assert.deepEqual(run.hook.poseRef.current.points, points);
  run.cleanup();
});

test("healthy tracking periodically checks coverage without resetting the working reference", () => {
  const run = setup();
  let request = run.startTracking();
  for (let i = 0; i < 51; i++) {
    run.reply(request, { type: "pose", status: "tracking", points });
    run.tick(100, 2 + i / 10);
    request = run.operations().at(-1);
  }
  const refreshes = run.operations().filter(operation => operation.refresh);
  assert.equal(refreshes.length, 1, "coverage work is bounded to one check in five seconds");
  assert.equal(refreshes[0].type, "frame", "coverage discovery does not freeze or reset tracking");
  assert.equal(run.hook.status, "tracking");
  assert.equal(run.hook.snapshotRef.current, null);
  assert.equal(run.operations().filter(operation => operation.type === "seed").length, 1);
  run.cleanup();
});

test("a slow coverage replacement updates reference metadata but waits for a fresh live pose", () => {
  const run = setup();
  let request = run.startTracking();
  while (!request.refresh) {
    run.reply(request, { type: "pose", status: "tracking", points });
    run.tick(100, run.video.currentTime + 0.1);
    request = run.operations().at(-1);
  }
  const replacement = observedProposal(20);
  run.advance(400);
  run.reply(request, { type: "pose", status: "tracking", points, replacement });
  assert.deepEqual(run.hook.replacementRef.current.proposal, replacement);
  assert.equal(run.hook.replacementRef.current.camera.video, run.video);
  assert.equal(run.hook.poseRef.current, null, "coverage detection never extends the 250ms pose lifetime");
  replacement.frets[3].a.x = 0;
  assert.notEqual(run.hook.replacementRef.current.proposal.frets[3].a.x, 0, "replacement data is copied");
  run.tick(1, run.video.currentTime + 0.1);
  const later = run.operations().at(-1);
  assert.equal(later.refresh, false);
  run.reply(later, { type: "pose", status: "tracking", points });
  assert.deepEqual(run.hook.poseRef.current.points, points);
  run.hook.pause();
  assert.equal(run.hook.replacementRef.current, null);
  run.cleanup();
});

test("unsolicited or malformed replacement cannot pair a new pose with old fret coordinates", () => {
  for (const kind of ["unsolicited", "malformed", "mismatched"]) {
    const run = setup();
    let request = run.startTracking();
    if (kind !== "unsolicited") {
      while (!request.refresh) {
        run.reply(request, { type: "pose", status: "tracking", points });
        run.tick(100, run.video.currentTime + 0.1);
        request = run.operations().at(-1);
      }
    }
    const replacement = kind === "malformed" ? { ...proposal, frets: [] } : proposal;
    const responsePoints = kind === "mismatched" ? points.map(point => ({ ...point, x: point.x + .01 })) : points;
    run.reply(request, { type: "pose", status: "tracking", points: responsePoints, replacement });
    assert.equal(run.hook.poseRef.current, null);
    assert.equal(run.hook.replacementRef.current, null);
    assert.equal(run.hook.status, "error");
    run.cleanup();
  }
});
