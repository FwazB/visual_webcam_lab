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
  const streams = [], contexts = [], worklets = [];
  const createStream = () => {
    const listeners = new Map();
    const track = { readyState: "live", enabled: true, muted: false,
      stop() { stops++; this.readyState = "ended"; }, getSettings: () => ({ sampleRate: 48000 }),
      addEventListener(event, callback) { listeners.set(event, callback); },
      removeEventListener(event) { listeners.delete(event); },
      emit(event) { listeners.get(event)?.(); },
      get listenerCount() { return listeners.size; },
    };
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream);
    return stream;
  };
  const graphNode = () => ({ connect(next) { return next; }, disconnect() {},
    frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } });
  class AudioContext {
    state = "running";
    currentTime = 0;
    audioWorklet = { addModule };
    constructor() { contexts.push(this); }
    async close() { this.state = "closed"; }
    createMediaStreamSource() { return graphNode(); }
    createBiquadFilter() { return graphNode(); }
  }
  class AudioWorkletNode {
    port = { onmessage: null, postMessage() {}, close() {} };
    constructor() { worklets.push(this); }
    disconnect() {}
  }
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const originalWorklet = Object.getOwnPropertyDescriptor(globalThis, "AudioWorkletNode");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: {
    enumerateDevices: async () => [{ kind: "audioinput", deviceId: "spark", label: "Spark PEDAL" }],
    getUserMedia: async () => createStream(),
    ...mediaDevices,
  } } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: AudioContext });
  Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, value: AudioWorkletNode });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalContext) Object.defineProperty(globalThis, "AudioContext", originalContext);
    else delete globalThis.AudioContext;
    if (originalWorklet) Object.defineProperty(globalThis, "AudioWorkletNode", originalWorklet);
    else delete globalThis.AudioWorkletNode;
  });
  const source = fs.readFileSync(require.resolve("../src/hooks/useGuitarPitch.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => name === "react" ? react : require(name), loaded, loaded.exports);
  const pitch = loaded.exports.useGuitarPitch(GUITAR_STANDARD);
  const cleanups = effects.map((effect) => effect()).filter(Boolean);
  return { pitch, states, contexts, streams, worklets, stops: () => stops, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
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
    module: loaded, context: ctx, ctxRef, syncInputRef: { current: () => true },
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

function playNote(handler, onset = 0.1) {
  handler({ data: { type: "onset", t: onset, strength: 1, rms: .2 } });
  for (let i = 1; i <= 3; i++) handler({ data: {
    type: "frame", t: onset + i * .02, hz: 110, clarity: .99, rms: .2, db: -20,
  } });
}

test("late worklet callbacks from a replaced input cannot dispatch notes into the current session", async (t) => {
  const run = setup(t, async () => {});
  const heard = [];
  run.pitch.onNote(note => heard.push(note));
  await run.pitch.start();
  const old = run.worklets[0].port.onmessage;
  playNote(old);
  assert.equal(heard.length, 1);
  await run.pitch.start();
  assert.equal(run.worklets[0].port.onmessage, null);
  assert.equal(run.streams[0].track.listenerCount, 0);
  playNote(old, 1);
  assert.equal(heard.length, 1);
  playNote(run.worklets[1].port.onmessage, 2);
  assert.equal(heard.length, 2);
  assert.ok(heard[1].id > heard[0].id, "note IDs remain monotonic across input replacement");
  run.unmount();
});

test("muted, disabled and ended capture cannot score while the audio context remains running", async (t) => {
  const run = setup(t, async () => {});
  const heard = [];
  run.pitch.onNote(note => heard.push(note));
  await run.pitch.start();
  const track = run.streams[0].track;
  const handler = run.worklets[0].port.onmessage;
  playNote(handler);
  assert.equal(heard.length, 1);
  track.muted = true;
  track.emit("mute");
  assert.equal(run.states[0], "unavailable");
  assert.equal(run.pitch.activeNoteRef.current, null);
  playNote(handler, 1);
  assert.equal(heard.length, 1);
  track.muted = false;
  track.emit("unmute");
  assert.equal(run.states[0], "running");
  playNote(handler, 2);
  assert.equal(heard.length, 2);
  track.enabled = false;
  playNote(handler, 3);
  assert.equal(run.states[0], "unavailable");
  assert.equal(heard.length, 2);
  track.enabled = true;
  playNote(handler, 4);
  assert.equal(heard.length, 3);
  track.readyState = "ended";
  track.emit("ended");
  assert.equal(run.states[0], "error");
  assert.match(run.states[1], /disconnected/);
  assert.equal(run.contexts[0].state, "closed");
  assert.equal(track.listenerCount, 0);
  playNote(handler, 5);
  assert.equal(heard.length, 3);
  run.unmount();
});

test("stopping an input disables its synthetic signal before closing its audio context", async (t) => {
  const run = setup(t, async () => {});
  await run.pitch.start();
  const signal = run.states[6];
  const enabled = [];
  const original = signal.setEnabled;
  signal.setEnabled = value => { enabled.push([value, run.contexts[0].state]); original(value); };
  run.pitch.stop();
  assert.deepEqual(enabled, [[false, "running"]]);
  assert.equal(run.states[6], null);
  run.unmount();
});
