/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node hook tests use the CommonJS TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

// Execute the production hook with persistent refs, dependency-aware effects,
// rerenders and a controlled animation clock. No camera or model is loaded.
function setup(vision, video = null) {
  const states = [];
  const refs = [];
  const effects = [];
  const frames = new Map();
  const videoRef = { current: video };
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let pendingEffects = [];
  let dirty = false;
  let mounted = true;
  let now = 0;
  let nextFrameId = 1;
  let value;
  const react = {
    useRef(initial) {
      const i = refIndex++;
      return refs[i] ??= { current: initial };
    },
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (next) => {
        const updated = typeof next === "function" ? next(states[i]) : next;
        if (!Object.is(states[i], updated)) {
          states[i] = updated;
          dirty = true;
        }
      }];
    },
    useEffect(effect, deps) {
      const i = effectIndex++;
      const previous = effects[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const source = fs.readFileSync(require.resolve("../src/hooks/useHandTracking.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  const requireMock = (name) => {
    if (name === "react") return react;
    if (name === "@mediapipe/tasks-vision") return vision;
    if (name === "@/lib/mediapipe") return { MEDIAPIPE_WASM_URL: "mock://vision" };
    throw new Error(`Unexpected import: ${name}`);
  };
  const requestFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  };
  new Function("require", "module", "exports", "requestAnimationFrame", "cancelAnimationFrame", "performance", outputText)(
    requireMock, loaded, loaded.exports, requestFrame, (id) => frames.delete(id), { now: () => now },
  );
  function render() {
    if (!mounted) return;
    stateIndex = refIndex = effectIndex = 0;
    pendingEffects = [];
    dirty = false;
    value = loaded.exports.useHandTracking(videoRef);
    pendingEffects.forEach((effect) => effect());
  }
  render();
  return {
    states,
    videoRef,
    get value() { return value; },
    get now() { return now; },
    get pendingFrames() { return frames.size; },
    elapse(milliseconds) { now += milliseconds; },
    async flush() {
      await new Promise(setImmediate);
      if (dirty) render();
    },
    frame(time) {
      now = time;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
      if (dirty) render();
    },
    cleanup() {
      if (!mounted) return;
      mounted = false;
      effects.forEach((effect) => effect.cleanup?.());
    },
  };
}

function makeVideo() {
  return { currentTime: 0, readyState: 2, paused: false, ended: false, videoWidth: 960, videoHeight: 540, srcObject: null };
}

function workingVision(detectForVideo, close = () => {}) {
  return {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => ({ detectForVideo, close }) },
  };
}

function handResult() {
  return {
    landmarks: [[{ x: 0.2, y: 0.3, z: -0.1 }]],
    handednesses: [[{ categoryName: "Left", score: 0.94 }]],
  };
}

function assertCleared(run) {
  assert.deepEqual(run.value.handsRef.current, []);
  assert.equal(run.value.handsUpdatedAtRef.current, -Infinity);
}

test("failed WASM loading clears the spinner and exposes a safe error", async () => {
  let creates = 0;
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => { throw new Error("private URL / token"); } },
    HandLandmarker: { createFromOptions: async () => { creates++; } },
  });
  await run.flush();
  assert.equal(run.value.isLoading, false);
  assert.match(run.value.error, /Hand tracking could not start/);
  assert.doesNotMatch(run.value.error, /private|token/);
  assert.equal(creates, 0);
  assertCleared(run);
  run.cleanup();
});

test("failed GPU/model initialization clears loading instead of rejecting unhandled", async () => {
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => { throw new Error("GPU unavailable"); } },
  });
  await run.flush();
  assert.equal(run.value.isLoading, false);
  assert.match(run.value.error, /audio practice still works/);
  assertCleared(run);
  run.cleanup();
});

test("a detector created after unmount is closed without updating state", async () => {
  let finish;
  let closed = 0;
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: () => new Promise((resolve) => { finish = resolve; }) },
  });
  await run.flush();
  run.cleanup();
  finish({ close: () => { closed++; } });
  await run.flush();
  assert.equal(closed, 1);
  assert.equal(run.states[0], true);
  assert.equal(run.states[1], null);
  assertCleared(run);
});

test("normal unmount releases the detector once and clears live observations", async () => {
  let closed = 0;
  const run = setup(workingVision(handResult, () => { closed++; }), makeVideo());
  await run.flush();
  run.frame(100);
  assert.equal(run.value.handsRef.current.length, 1);
  assert.equal(run.pendingFrames, 1);
  run.cleanup();
  run.cleanup();
  assert.equal(closed, 1);
  assert.equal(run.pendingFrames, 0);
  assertCleared(run);
});

test("only newly decoded frames refresh raw hand evidence", async () => {
  const video = makeVideo();
  const result = handResult();
  const calls = [];
  const run = setup(workingVision((input, timestamp) => { calls.push({ input, timestamp }); return result; }), video);
  assertCleared(run);
  await run.flush();
  run.frame(100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, video);
  assert.equal(calls[0].timestamp, 100);
  assert.equal(run.value.handsRef.current[0].landmarks, result.landmarks[0]);
  assert.deepEqual(run.value.handsRef.current[0], { landmarks: result.landmarks[0], label: "Left", score: 0.94 });
  assert.equal(run.value.handsUpdatedAtRef.current, 100);
  run.frame(150);
  assert.equal(calls.length, 1);
  assert.equal(run.value.handsUpdatedAtRef.current, 100);
  video.currentTime = 1 / 30;
  run.frame(160);
  assert.equal(calls.length, 2);
  assert.equal(run.value.handsUpdatedAtRef.current, 160);
  run.cleanup();
});

test("a stalled frame expires and only a new frame can restore evidence", async () => {
  const video = makeVideo();
  let calls = 0;
  const run = setup(workingVision(() => { calls++; return handResult(); }), video);
  await run.flush();
  run.frame(100);
  run.frame(351);
  assertCleared(run);
  assert.equal(calls, 1);
  run.frame(400);
  assertCleared(run);
  assert.equal(calls, 1);
  video.currentTime = 1 / 30;
  run.frame(420);
  assert.equal(run.value.handsRef.current.length, 1);
  assert.equal(run.value.handsUpdatedAtRef.current, 420);
  assert.equal(calls, 2);
  run.cleanup();
});

test("slow inference retains its observation time instead of appearing newly observed at completion", async () => {
  const video = makeVideo();
  let inferenceTimestamp;
  const run = setup(workingVision((input, timestamp) => {
    inferenceTimestamp = timestamp;
    run.elapse(400);
    return handResult();
  }), video);
  await run.flush();
  run.frame(100);
  assert.equal(inferenceTimestamp, 100);
  assert.equal(run.value.handsUpdatedAtRef.current, 100);
  assert.equal(run.now - run.value.handsUpdatedAtRef.current, 400);
  run.frame(510);
  assertCleared(run);
  run.cleanup();
});

for (const [name, invalidate] of [
  ["missing", (video, ref) => { ref.current = null; }],
  ["unready", (video) => { video.readyState = 1; }],
  ["paused", (video) => { video.paused = true; }],
  ["ended", (video) => { video.ended = true; }],
  ["without decoded dimensions", (video) => { video.videoWidth = 0; }],
  ["with an ended camera track", (video) => { video.srcObject = { getVideoTracks: () => [{ readyState: "ended", enabled: true, muted: false }] }; }],
  ["with a muted camera track", (video) => { video.srcObject = { getVideoTracks: () => [{ readyState: "live", enabled: true, muted: true }] }; }],
]) {
  test(`a ${name} video immediately clears previous fingers`, async () => {
    const video = makeVideo();
    let calls = 0;
    const run = setup(workingVision(() => { calls++; return handResult(); }), video);
    await run.flush();
    run.frame(100);
    invalidate(video, run.videoRef);
    run.frame(110);
    assertCleared(run);
    assert.equal(calls, 1);
    run.cleanup();
  });
}

test("resuming a paused video does not count its old frame as new evidence", async () => {
  const video = makeVideo();
  let calls = 0;
  const run = setup(workingVision(() => { calls++; return handResult(); }), video);
  await run.flush();
  run.frame(100);
  video.paused = true;
  run.frame(110);
  video.paused = false;
  run.frame(120);
  assertCleared(run);
  assert.equal(calls, 1);
  video.currentTime = 1 / 30;
  run.frame(130);
  assert.equal(calls, 2);
  assert.equal(run.value.handsUpdatedAtRef.current, 130);
  run.cleanup();
});

test("successful empty inference removes earlier fingers but records fresh absence", async () => {
  const video = makeVideo();
  let calls = 0;
  const run = setup(workingVision(() => ++calls === 1 ? handResult() : { landmarks: [] }), video);
  await run.flush();
  run.frame(100);
  video.currentTime = 1 / 30;
  run.frame(130);
  assert.deepEqual(run.value.handsRef.current, []);
  assert.equal(run.value.handsUpdatedAtRef.current, 130);
  run.cleanup();
});

test("runtime inference failure clears fingers, stops scheduling and preserves usable audio guidance", async () => {
  const video = makeVideo();
  let calls = 0;
  let closed = 0;
  const run = setup(workingVision(() => {
    if (++calls > 1) throw new Error("private GPU failure details");
    return handResult();
  }, () => { closed++; }), video);
  await run.flush();
  run.frame(100);
  video.currentTime = 1 / 30;
  assert.doesNotThrow(() => run.frame(130));
  assertCleared(run);
  assert.equal(run.value.isLoading, false);
  assert.match(run.value.error, /Hand tracking stopped.*audio practice still works/);
  assert.doesNotMatch(run.value.error, /private|GPU/);
  assert.equal(run.pendingFrames, 0);
  video.currentTime = 2 / 30;
  run.frame(160);
  assert.equal(calls, 2);
  run.cleanup();
  assert.equal(closed, 1);
});
