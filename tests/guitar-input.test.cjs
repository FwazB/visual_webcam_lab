/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node hook tests use the CommonJS TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { GUITAR_STANDARD } = require("../src/lib/instrument/profile");

// Keep React rendering out of these lifecycle tests; exercise the actual hook
// callbacks against controlled media permissions and worklet module promises.
function setup(t, addModule, mediaDevices = {}) {
  const states = [];
  const effects = [];
  const react = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const i = states.length;
      states.push(initial);
      return [initial, (next) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
    },
    useEffect: (effect) => { effects.push(effect); },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  };
  let stops = 0;
  const track = { stop: () => { stops++; }, getSettings: () => ({ sampleRate: 48000 }) };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const contexts = [];
  class AudioContext {
    state = "running";
    audioWorklet = { addModule };
    constructor() { contexts.push(this); }
    async close() { this.state = "closed"; }
  }
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    enumerateDevices: async () => [{ kind: "audioinput", deviceId: "spark", label: "Spark PEDAL" }],
    getUserMedia: async () => stream,
    ...mediaDevices,
  } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: AudioContext });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalContext) Object.defineProperty(globalThis, "AudioContext", originalContext);
    else delete globalThis.AudioContext;
  });
  const source = fs.readFileSync(require.resolve("../src/hooks/useGuitarPitch.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => name === "react" ? react : require(name), loaded, loaded.exports);
  const pitch = loaded.exports.useGuitarPitch(GUITAR_STANDARD);
  const cleanups = effects.map((effect) => effect()).filter(Boolean);
  return { pitch, states, contexts, stops: () => stops, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("a worklet load failure releases the microphone and audio context", async (t) => {
  t.mock.method(console, "error", () => {});
  const run = setup(t, async () => { throw new Error("module unavailable"); });
  await run.pitch.start();
  assert.equal(run.states[0], "error");
  assert.equal(run.states[1], "module unavailable");
  assert.equal(run.states[5], null);
  assert.ok(run.stops() >= 1);
  assert.equal(run.contexts[0].state, "closed");
});

test("stopping during worklet loading prevents a stale connection from starting", async (t) => {
  let finish;
  const run = setup(t, () => new Promise((resolve) => { finish = resolve; }));
  const pending = run.pitch.start();
  await new Promise(setImmediate);
  assert.equal(run.contexts.length, 1);
  run.pitch.stop();
  finish();
  await pending;
  assert.equal(run.states[0], "idle");
  assert.equal(run.states[5], null);
  assert.ok(run.stops() >= 1);
  assert.equal(run.contexts[0].state, "closed");
});

for (const action of ["stop", "unmount"]) {
  test(`${action} during device discovery releases a late microphone probe`, async (t) => {
    let grant;
    let stopped = 0;
    let enumerations = 0;
    const probe = { getTracks: () => [{ stop: () => { stopped++; } }] };
    const run = setup(t, async () => assert.fail("must not create the pitch engine"), {
      enumerateDevices: async () => { enumerations++; return []; },
      getUserMedia: () => new Promise((resolve) => { grant = resolve; }),
    });
    const pending = run.pitch.start();
    await new Promise(setImmediate);
    if (action === "stop") run.pitch.stop();
    else run.unmount();
    await pending;
    grant(probe);
    await new Promise(setImmediate);
    assert.equal(stopped, 1);
    assert.equal(enumerations, 1);
    assert.equal(run.states[0], "idle");
    assert.equal(run.contexts.length, 0);
  });
}

test("device changes only enumerate metadata and discard results after effect cleanup", async () => {
  const source = fs.readFileSync(require.resolve("../src/hooks/useGuitarPitch.ts"), "utf8");
  const tree = ts.createSourceFile("useGuitarPitch.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect") {
      let deviceEffect = false;
      const findHandler = (child) => {
        if (ts.isVariableDeclaration(child) && child.name.getText(tree) === "onDeviceChange") deviceEffect = true;
        ts.forEachChild(child, findHandler);
      };
      ts.forEachChild(node.arguments[0], findHandler);
      if (deviceEffect) effect = node.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect, "the production device-change effect exists");
  const pending = [];
  const updates = [];
  let handler;
  const ctx = { state: "running" };
  const ctxRef = { current: ctx };
  const loaded = { exports: {} };
  const output = ts.transpileModule(`module.exports = ${effect}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, {
    module: loaded, context: ctx, ctxRef,
    setStatus() {}, setDevices: (devices) => updates.push(devices),
    listAudioInputs: () => assert.fail("background refresh cannot request a permission probe"),
    window: { setInterval() { return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { addEventListener() {}, removeEventListener() {} },
    navigator: { mediaDevices: {
      addEventListener: (_event, callback) => { handler = callback; }, removeEventListener() {},
      enumerateDevices: () => new Promise((resolve) => pending.push(resolve)),
      getUserMedia: () => assert.fail("background refresh cannot open a microphone"),
    } },
  });
  const cleanup = loaded.exports();
  handler();
  pending.shift()([{ kind: "audioinput", deviceId: "spark" }, { kind: "videoinput" }]);
  await new Promise(setImmediate);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].length, 1);
  assert.equal(updates[0][0].deviceId, "spark");
  handler();
  cleanup();
  pending.shift()([{ kind: "audioinput", deviceId: "stale" }]);
  await new Promise(setImmediate);
  assert.equal(updates.length, 1);
  ctxRef.current = null;
  handler();
  assert.equal(pending.length, 0, "a stopped context cannot start discovery");
});
