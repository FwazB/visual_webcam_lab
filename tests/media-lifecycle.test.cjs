/* eslint-disable @typescript-eslint/no-require-imports -- Executes production media effects with Node's CommonJS test bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise(setImmediate);

function mediaStream() {
  let stopped = 0;
  return { getTracks: () => [{ stop: () => { stopped++; } }], stopped: () => stopped };
}

// Extract the real camera effect so the test exercises its asynchronous
// lifetime without starting unrelated rendering/ML hooks or a real camera.
function cameraEffect(name) {
  const source = fs.readFileSync(require.resolve(`../src/components/${name}.tsx`), "utf8");
  const tree = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).includes("getUserMedia")) {
      effect = node.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect, "camera effect exists");
  let finish;
  const video = { srcObject: null };
  const context = {
    module: { exports: {} },
    window: { innerWidth: 1280 },
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { finish = resolve; }) } },
    videoRef: { current: video },
    setWebcamReady() {},
    console,
  };
  vm.runInNewContext(compile(`module.exports = ${effect}`), context);
  const cleanup = context.module.exports();
  return { finish: (stream) => finish(stream), cleanup, video };
}

for (const name of ["AsciiCamera", "BodySynth", "Visualz"]) {
  test(`${name} releases a camera granted after navigation`, async () => {
    const run = cameraEffect(name);
    const stream = mediaStream();
    run.cleanup();
    run.finish(stream);
    await flush();
    assert.equal(stream.stopped(), 1);
    assert.equal(run.video.srcObject, null);
  });

  test(`${name} releases an active camera on normal unmount`, async () => {
    const run = cameraEffect(name);
    const stream = mediaStream();
    run.finish(stream);
    await flush();
    assert.equal(run.video.srcObject, stream);
    run.cleanup();
    assert.equal(stream.stopped(), 1);
  });
}

function audioInput(failAt) {
  const states = [];
  const effects = [];
  const pending = [];
  const contexts = [];
  let frames = 0;
  const react = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const index = states.length;
      states.push(initial);
      return [initial, (value) => { states[index] = value; }];
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  };
  class AudioContext {
    state = "running";
    sampleRate = 48000;
    constructor() {
      if (failAt === "constructor") throw new Error("Audio context unavailable");
      contexts.push(this);
    }
    createAnalyser() {
      if (failAt === "analyser") throw new Error("Audio graph unavailable");
      return { fftSize: 1024, frequencyBinCount: 512, getByteTimeDomainData: (array) => array.fill(128), getByteFrequencyData: (array) => array.fill(0) };
    }
    createMediaStreamSource() { return { connect() {} }; }
    async close() { this.state = "closed"; }
  }
  const context = {
    exports: {},
    require: () => react,
    window: { AudioContext },
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => pending.push(resolve)) } },
    cancelAnimationFrame() {},
    requestAnimationFrame: () => ++frames,
  };
  vm.runInNewContext(compile(fs.readFileSync(require.resolve("../src/hooks/useAudioReactiveInput.ts"), "utf8")), context);
  const hook = context.exports.useAudioReactiveInput();
  return { hook, unmount: effects[0](), pending, contexts, states, frames: () => frames };
}

test("visual audio input releases permission granted after unmount", async () => {
  const run = audioInput();
  const stream = mediaStream();
  const start = run.hook.start();
  run.unmount();
  run.pending[0](stream);
  await start;
  assert.equal(stream.stopped(), 1);
  assert.equal(run.frames(), 0);
  assert.equal(run.contexts.length, 0);
  assert.equal(run.states[0], false);
});

for (const failAt of ["constructor", "analyser"]) {
  test(`visual audio input releases acquired resources after ${failAt} failure`, async () => {
    const run = audioInput(failAt);
    const stream = mediaStream();
    const start = run.hook.start();
    run.pending[0](stream);
    await start;
    assert.equal(stream.stopped(), 1);
    assert.equal(run.states[0], false);
    assert.ok(run.states[1]);
    assert.ok(run.contexts.every((ctx) => ctx.state === "closed"));
  });
}

test("repeated connect attempts retain only the latest microphone", async () => {
  const run = audioInput();
  const first = mediaStream();
  const second = mediaStream();
  const startFirst = run.hook.start();
  const startSecond = run.hook.start();
  run.pending[1](second);
  await startSecond;
  run.pending[0](first);
  await startFirst;
  assert.equal(first.stopped(), 1);
  assert.equal(second.stopped(), 0);
  assert.equal(run.contexts.length, 1);
  run.hook.stop();
  assert.equal(second.stopped(), 1);
  assert.equal(run.contexts[0].state, "closed");
});
