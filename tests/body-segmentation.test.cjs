/* eslint-disable @typescript-eslint/no-require-imports -- Executes the production hook with borrowed mask storage and controlled media lifetimes. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = fs.readFileSync(require.resolve("../src/hooks/useBodySegmentation.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ infer, create, close = () => {} } = {}) {
  const effects = [], states = [], frames = new Map();
  let nextFrame = 0;
  const videoRef = { current: { readyState: 2, currentTime: 1, paused: false, ended: false } };
  const react = {
    useRef: (current) => ({ current }),
    useState(initial) {
      const i = states.length;
      states.push(initial);
      return [initial, (value) => { states[i] = value; }];
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  };
  const segmenter = {
    close,
    segmentForVideo: (video, at, callback) => infer?.(callback, video, at),
  };
  const vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    ImageSegmenter: { createFromOptions: create ?? (async () => segmenter) },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "requestAnimationFrame", "cancelAnimationFrame", "performance", code)(
    (name) => name === "react" ? react : name === "@mediapipe/tasks-vision" ? vision : { MEDIAPIPE_WASM_URL: "mock://vision" },
    loaded, loaded.exports,
    (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    (id) => frames.delete(id), { now: () => 100 },
  );
  const hook = loaded.exports.useBodySegmentation(videoRef);
  const cleanup = effects[0]();
  return {
    hook, frames, states, videoRef, cleanup,
    flush: () => new Promise(setImmediate),
    step() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

const maskResult = (values) => ({ confidenceMasks: [{ width: 2, height: 1, getAsFloat32Array: () => values }] });
const assertCleared = (run) => {
  assert.equal(run.hook.maskRef.current, null);
  assert.deepEqual(run.hook.maskSizeRef.current, { width: 0, height: 0 });
};

test("segmentation copies callback-owned mask storage before MediaPipe can reuse it", async () => {
  const borrowed = new Float32Array([0.25, 0.75]);
  const run = setup({ infer(callback) { callback(maskResult(borrowed)); borrowed.fill(-999); } });
  await run.flush();
  run.hook.startSegmentation();
  run.step();
  assert.notEqual(run.hook.maskRef.current, borrowed);
  assert.deepEqual([...run.hook.maskRef.current], [0.25, 0.75]);
  assert.deepEqual(run.hook.maskSizeRef.current, { width: 2, height: 1 });
  run.cleanup();
});

test("stopping clears mask dimensions, cancels the loop and ignores a late callback", async () => {
  let pending;
  const run = setup({ infer(callback) { pending = callback; callback(maskResult(new Float32Array([0.25, 0.75]))); } });
  await run.flush();
  const stop = run.hook.startSegmentation();
  run.step();
  assert.equal(run.hook.maskRef.current.length, 2);
  stop();
  assertCleared(run);
  assert.equal(run.frames.size, 0);
  pending(maskResult(new Float32Array([1, 1])));
  assertCleared(run);
  run.cleanup();
});

test("inference failure clears previous masks and halts without an uncaught callback error", async () => {
  let calls = 0;
  const run = setup({ infer(callback) {
    if (++calls > 1) throw new Error("GPU context lost");
    callback(maskResult(new Float32Array([0.25, 0.75])));
  } });
  await run.flush();
  run.hook.startSegmentation();
  run.step();
  run.videoRef.current.currentTime++;
  assert.doesNotThrow(() => run.step());
  assertCleared(run);
  assert.equal(run.frames.size, 0);
  run.cleanup();
});

test("empty results and stopped video cannot retain an earlier foreground mask", async () => {
  let empty = false;
  const run = setup({ infer: (callback) => callback(empty ? { confidenceMasks: [] } : maskResult(new Float32Array([1, 1]))) });
  await run.flush();
  run.hook.startSegmentation();
  run.step();
  empty = true;
  run.videoRef.current.currentTime++;
  run.step();
  assertCleared(run);
  empty = false;
  run.videoRef.current.currentTime++;
  run.step();
  assert.equal(run.hook.maskRef.current.length, 2);
  run.videoRef.current.ended = true;
  run.step();
  assertCleared(run);
  run.cleanup();
});

test("repeated starts own only one RAF chain and cleanup clears it even if GPU close fails", async () => {
  const run = setup({ infer: (callback) => callback(maskResult(new Float32Array([1, 1]))), close() { throw new Error("GPU already gone"); } });
  await run.flush();
  run.hook.startSegmentation();
  run.hook.startSegmentation();
  assert.equal(run.frames.size, 1);
  run.step();
  const lateTick = [...run.frames.values()][0];
  assert.doesNotThrow(run.cleanup);
  assertCleared(run);
  assert.equal(run.frames.size, 0);
  lateTick();
  run.hook.startSegmentation();
  assert.equal(run.frames.size, 0);
});

test("model creation resolving after unmount releases its detector and never starts segmentation", async () => {
  let finish, closed = 0;
  const run = setup({ create: () => new Promise((resolve) => { finish = resolve; }) });
  await run.flush();
  run.cleanup();
  finish({ close() { closed++; } });
  await run.flush();
  assert.equal(closed, 1);
  assert.equal(run.states[0], true);
  run.hook.startSegmentation();
  assert.equal(run.frames.size, 0);
  assertCleared(run);
});
