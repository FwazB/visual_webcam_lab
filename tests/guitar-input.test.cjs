/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node hook tests use the CommonJS TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { GUITAR_STANDARD } = require("../src/lib/instrument/profile");

// Keep React rendering out of these lifecycle tests; exercise the actual hook
// callbacks against controlled media permissions and worklet module promises.
function setup(t, addModule) {
  const states = [];
  const react = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const i = states.length;
      states.push(initial);
      return [initial, (next) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
    },
    useEffect: () => {},
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
  return { pitch: loaded.exports.useGuitarPitch(GUITAR_STANDARD), states, contexts, stops: () => stops };
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
