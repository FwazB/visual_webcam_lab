/* eslint-disable @typescript-eslint/no-require-imports -- Executes the actual hook with controlled React and audio primitives. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const compiled = ts.transpileModule(fs.readFileSync(require.resolve("../src/hooks/useSongTransport.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function audioContext({ time = 0, state = "suspended", resume } = {}) {
  return {
    currentTime: time, state, resumeCalls: 0, closeCalls: 0,
    resume() {
      this.resumeCalls++;
      if (resume) return resume.call(this);
      this.state = "running";
      return Promise.resolve();
    },
    close() { this.closeCalls++; this.state = "closed"; return Promise.resolve(); },
  };
}

function setup({ input = null, previewResume } = {}) {
  const states = [], refs = [], effects = [], memos = [], frames = new Map(), nativeContexts = [], voices = [], transports = new Map();
  let stateIndex = 0, refIndex = 0, effectIndex = 0, memoIndex = 0, nextFrame = 1, dirty = false, mounted = true, hook, now = 0;
  let pendingEffects = [];
  const originalToneContext = audioContext({ time: .01, state: "running" });
  let toneContext = originalToneContext;
  const calls = { setContext: [], toneStart: 0 };
  const props = { input, chart: { id: "test", title: "Test", bpm: 120, beatsPerBar: 4, bars: [], voicings: {} } };
  const react = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = initial;
      return [states[i], next => {
        const value = typeof next === "function" ? next(states[i]) : next;
        if (!Object.is(value, states[i])) { states[i] = value; dirty = true; }
      }];
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(effect, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || !deps || deps.some((value, index) => !Object.is(value, previous.deps?.[index]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; });
      }
    },
    useMemo(factory, deps) {
      const i = memoIndex++, previous = memos[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) memos[i] = { deps, value: factory() };
      return memos[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
  };
  class NativeAudioContext {
    constructor(options) {
      const context = audioContext({ resume: previewResume });
      context.options = options;
      nativeContexts.push(context);
      return context;
    }
  }
  class Voice {
    constructor() { this.volume = { value: 0 }; this.disposed = 0; this.played = []; voices.push(this); }
    connect() { return this; }
    toDestination() { return this; }
    dispose() { this.disposed++; }
    triggerAttackRelease(...args) { this.played.push(args); }
  }
  function getTransport() {
    if (!transports.has(toneContext)) {
      const transport = { stops: 0, cancels: [], cleared: [], starts: [], schedules: [], position: 0,
        bpm: { value: 0, changes: [], setValueAtTime(value, time) { this.changes.push({ value, time }); } },
        stop() { this.stops++; }, cancel(value) { this.cancels.push(value); }, clear(id) { this.cleared.push(id); },
        start(time) { this.starts.push(time); },
        scheduleRepeat(callback, interval, at) { this.schedules.push({ callback, interval, at }); return this.schedules.length; },
      };
      transports.set(toneContext, transport);
    }
    return transports.get(toneContext);
  }
  const tone = {
    Gain: Voice, MembraneSynth: Voice, NoiseSynth: Voice, MonoSynth: Voice,
    getContext: () => ({ rawContext: toneContext, state: toneContext.state }),
    setContext(context) { toneContext = context; calls.setContext.push(context); },
    getTransport,
    now: () => toneContext.currentTime,
    start() { calls.toneStart++; return toneContext.resume(); },
    Frequency: midi => ({ toFrequency: () => 440 * 2 ** ((midi - 69) / 12) }),
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "AudioContext", "window", "requestAnimationFrame", "cancelAnimationFrame", "performance", compiled)(
    name => name === "react" ? react : name === "tone" ? tone : require(name), loaded, loaded.exports,
    NativeAudioContext, { AudioContext: NativeAudioContext },
    callback => { const id = nextFrame++; frames.set(id, callback); return id; }, id => frames.delete(id),
    { now: () => now },
  );
  function render() {
    if (!mounted) return;
    stateIndex = refIndex = effectIndex = memoIndex = 0;
    dirty = false;
    pendingEffects = [];
    hook = loaded.exports.useSongTransport(props.chart, props.input);
    pendingEffects.forEach(effect => effect());
  }
  function flush() {
    for (let attempts = 0; dirty && attempts < 10; attempts++) render();
    assert.equal(dirty, false, "effects settle without an update loop");
  }
  render(); flush();
  return {
    nativeContexts, voices, transports, calls, originalToneContext, frames,
    get hook() { flush(); return hook; },
    get toneContext() { return toneContext; },
    get transport() { return getTransport(); },
    setInput(input) { props.input = input; render(); flush(); },
    frame(rafTime = now, wallTime = rafTime) {
      now = wallTime;
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback(rafTime));
      flush();
    },
    cleanup() { mounted = false; effects.forEach(effect => effect.cleanup?.()); },
  };
}

test("preview creates and synchronously resumes its own native interactive audio context", async () => {
  const run = setup();
  const starting = run.hook.start();
  assert.equal(run.nativeContexts.length, 1);
  const context = run.nativeContexts[0];
  assert.deepEqual(context.options, { latencyHint: "interactive" });
  assert.equal(context.resumeCalls, 1, "resume starts inside the user gesture, before awaiting anything");
  assert.equal(run.originalToneContext.resumeCalls, 0, "Tone's pre-existing frozen clock is not reused");
  await starting;
  assert.equal(run.hook.playing, true);
  assert.equal(run.toneContext, context);
  assert.equal(run.transport.schedules.length, 1);
  assert.deepEqual(run.transport.starts, [.1]);
  assert.equal(run.hook.beatsRef.current, -4);
  run.cleanup();
  assert.equal(context.closeCalls, 1);
});

test("animation beats follow native currentTime and never advance from wall-clock RAF time", async () => {
  const run = setup();
  await run.hook.start();
  const context = run.nativeContexts[0];
  assert.equal(run.hook.playing, true);
  context.currentTime = 2.1;
  run.frame(9000);
  assert.ok(Math.abs(run.hook.beatsRef.current) < 1e-9, "four-beat count-in ends on the audio clock");
  context.currentTime = 2.6;
  run.frame(10000);
  assert.ok(Math.abs(run.hook.beatsRef.current - 1) < 1e-9);
  run.frame(9000000);
  assert.ok(Math.abs(run.hook.beatsRef.current - 1) < 1e-9, "a stalled audio clock cannot fake live playback");
  assert.ok(Math.abs(run.hook.beatsAt(2.35) - .5) < 1e-9, "pitch timestamps share the same beat clock");
  run.cleanup();
});

test("scored playback uses the exact input clock and never closes the borrowed context", async () => {
  const input = audioContext({ time: 10 });
  const run = setup({ input });
  const starting = run.hook.start();
  assert.equal(input.resumeCalls, 1);
  assert.equal(run.nativeContexts.length, 0);
  await starting;
  assert.equal(run.hook.playing, true);
  assert.equal(run.toneContext, input);
  assert.deepEqual(run.transport.starts, [10.1]);
  input.currentTime = 12.6;
  run.frame();
  assert.ok(Math.abs(run.hook.beatsRef.current - 1) < 1e-9);
  run.hook.stop();
  assert.equal(run.hook.playing, false);
  assert.equal(input.closeCalls, 0);
  run.cleanup();
  assert.equal(input.closeCalls, 0);
});

test("a context suspended during playback stops the transport rather than pretending its clock is live", async () => {
  const run = setup();
  await run.hook.start();
  assert.equal(run.hook.playing, true);
  const context = run.nativeContexts[0];
  context.currentTime = 1;
  run.frame();
  const heldBeat = run.hook.beatsRef.current;
  context.state = "suspended";
  run.frame(100000);
  assert.equal(run.hook.playing, false);
  assert.match(run.hook.error, /audio|resume|restart|paused|stopped/i);
  assert.equal(run.hook.beatsRef.current, heldBeat);
  assert.equal(run.frames.size, 0);
  assert.ok(run.transport.cleared.includes(1));
  await run.hook.start();
  assert.equal(run.hook.error, null);
  assert.equal(run.hook.playing, true);
  run.cleanup();
});

for (const state of ["suspended", "interrupted", "closed"]) {
  test(`resume completion cannot start playback while its context remains ${state}`, async () => {
    const input = audioContext({ state, resume() { return Promise.resolve(); } });
    const run = setup({ input });
    await assert.rejects(run.hook.start(), /audio|running|resume|closed|suspend/i);
    assert.equal(run.hook.playing, false);
    assert.equal([...run.transports.values()].reduce((sum, transport) => sum + transport.schedules.length, 0), 0);
    assert.equal(run.voices.length, 0);
    run.cleanup();
    assert.equal(input.closeCalls, 0);
  });
}

test("resume rejection does not schedule playback or leave owned preview audio open on unmount", async () => {
  const run = setup({ previewResume() { return Promise.reject(new Error("Audio permission unavailable")); } });
  await assert.rejects(run.hook.start(), /permission unavailable/);
  assert.equal(run.hook.playing, false);
  assert.equal(run.voices.length, 0);
  run.cleanup();
  assert.equal(run.nativeContexts[0].closeCalls, 1);
});

test("stop invalidates an in-flight resume and a later start can reuse its owned preview clock", async () => {
  const resume = deferred();
  const run = setup({ previewResume() { return resume.promise.then(() => { this.state = "running"; }); } });
  const first = run.hook.start();
  assert.equal(run.nativeContexts[0].resumeCalls, 1);
  run.hook.stop();
  resume.resolve();
  await first;
  assert.equal(run.hook.playing, false);
  assert.equal(run.voices.length, 0);
  assert.equal([...run.transports.values()].reduce((sum, transport) => sum + transport.schedules.length, 0), 0);
  await run.hook.start();
  assert.equal(run.nativeContexts.length, 1);
  assert.equal(run.hook.playing, true);
  assert.equal(run.transport.schedules.length, 1);
  run.cleanup();
});

test("connecting input while preview resume is pending closes only owned audio and rejects the stale start", async () => {
  const resume = deferred();
  const run = setup({ previewResume() { return resume.promise.then(() => { this.state = "running"; }); } });
  const starting = run.hook.start();
  const preview = run.nativeContexts[0];
  const input = audioContext({ time: 50 });
  run.setInput(input);
  assert.equal(preview.closeCalls, 1);
  resume.resolve();
  await starting;
  assert.equal(run.hook.playing, false);
  assert.equal(run.voices.length, 0);
  assert.equal(run.calls.setContext.includes(preview), false, "a stale preview cannot replace the new source's Tone clock");
  await run.hook.start();
  assert.equal(run.toneContext, input);
  assert.equal(run.hook.playing, true);
  assert.equal(input.closeCalls, 0);
  run.cleanup();
  assert.equal(input.closeCalls, 0);
});

test("changing a borrowed input cancels its pending start without closing either input", async () => {
  const resume = deferred();
  const old = audioContext({ resume() { return resume.promise.then(() => { this.state = "running"; }); } });
  const run = setup({ input: old });
  const starting = run.hook.start();
  const replacement = audioContext({ time: 20 });
  run.setInput(replacement);
  resume.resolve();
  await starting;
  assert.equal(run.hook.playing, false);
  assert.equal(run.voices.length, 0);
  assert.equal(old.closeCalls, 0);
  await run.hook.start();
  assert.equal(run.toneContext, replacement);
  assert.equal(run.hook.playing, true);
  run.cleanup();
  assert.equal(old.closeCalls, 0);
  assert.equal(replacement.closeCalls, 0);
});

test("unmount invalidates pending audio startup and releases scheduled frames and voices", async () => {
  const resume = deferred();
  const pending = setup({ previewResume() { return resume.promise.then(() => { this.state = "running"; }); } });
  const starting = pending.hook.start();
  pending.cleanup();
  resume.resolve();
  await starting;
  assert.equal(pending.nativeContexts[0].closeCalls, 1);
  assert.equal(pending.voices.length, 0);
  assert.equal(pending.frames.size, 0);
  const active = setup();
  await active.hook.start();
  assert.equal(active.hook.playing, true);
  assert.equal(active.frames.size, 1);
  active.cleanup();
  assert.equal(active.frames.size, 0);
  assert.ok(active.voices.every(voice => voice.disposed === 1));
  assert.equal(active.nativeContexts[0].closeCalls, 1);
  assert.ok(active.transport.cleared.includes(1));
});

test("explicit silent preview advances visually without creating, resuming or scheduling audio", async () => {
  const run = setup();
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  assert.equal(run.hook.beatsRef.current, -4);
  assert.equal(run.nativeContexts.length, 0);
  assert.equal(run.voices.length, 0);
  assert.equal(run.calls.setContext.length, 0);
  assert.equal(run.calls.toneStart, 0);
  assert.equal(run.transports.size, 0);
  run.frame(999999, 500);
  assert.ok(Math.abs(run.hook.beatsRef.current + 3) < 1e-9);
  run.frame(2000);
  assert.ok(Math.abs(run.hook.beatsRef.current) < 1e-9, "silent preview has its own explicit visual count-in");
  run.frame(2500);
  assert.ok(Math.abs(run.hook.beatsRef.current - 1) < 1e-9);
  run.hook.stop();
  assert.equal(run.hook.playing, false);
  const heldBeat = run.hook.beatsRef.current;
  run.frame(5000);
  assert.equal(run.hook.beatsRef.current, heldBeat);
  assert.equal(run.frames.size, 0);
  run.cleanup();
});

test("silent preview tempo changes stay on the visual clock without touching Tone", async () => {
  const run = setup();
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  run.frame(500);
  assert.equal(run.hook.beatsRef.current, -3);
  run.hook.setBpm(60);
  run.frame(1000);
  assert.equal(run.hook.beatsRef.current, -2.5);
  assert.equal(run.transports.size, 0);
  assert.equal(run.nativeContexts.length, 0);
  run.cleanup();
});

test("explicit unscored silent preview leaves an already connected input entirely untouched", async () => {
  const input = audioContext({ time: 100 });
  const run = setup({ input });
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  run.frame(500);
  assert.equal(run.hook.beatsRef.current, -3);
  assert.equal(input.resumeCalls, 0);
  assert.equal(input.closeCalls, 0);
  assert.equal(input.state, "suspended");
  assert.equal(run.nativeContexts.length, 0);
  assert.equal(run.calls.setContext.length, 0);
  assert.equal(run.transports.size, 0);
  assert.equal(run.voices.length, 0);
  run.cleanup();
  assert.equal(input.closeCalls, 0);
});

for (const useInput of [false, true]) {
  test(`${useInput ? "scored input" : "audible preview"} stops after a running audio clock remains frozen for over one second`, async () => {
    const input = useInput ? audioContext({ time: 10 }) : null;
    const run = setup({ input });
    await run.hook.start();
    assert.equal(run.hook.playing, true);
    const context = input ?? run.nativeContexts[0];
    run.frame(500);
    const heldBeat = run.hook.beatsRef.current;
    assert.equal(run.hook.playing, true);
    run.frame(1000);
    assert.equal(run.hook.playing, true, "the watchdog allows a full second for genuine clock progress");
    run.frame(1001);
    assert.equal(context.state, "running", "a running state alone is insufficient evidence of live audio");
    assert.equal(run.hook.playing, false);
    assert.match(run.hook.error, /audio|output|restart|clock/i);
    assert.equal(run.hook.beatsRef.current, heldBeat, "default playback never falls back to wall-clock beats");
    assert.equal(run.frames.size, 0);
    assert.ok(run.transport.cleared.includes(1));
    await run.hook.start({ silent: true });
    assert.equal(run.hook.error, null, "an explicit restart clears the prior failure");
    assert.equal(run.hook.playing, true);
    run.cleanup();
    if (input) assert.equal(input.closeCalls, 0);
  });
}

test("real audio progress resets the stall watchdog while score timing stays on the input clock", async () => {
  const input = audioContext({ time: 10 });
  const run = setup({ input });
  await run.hook.start();
  assert.equal(run.hook.playing, true);
  for (let i = 1; i <= 4; i++) {
    input.currentTime = 10 + i * .5;
    run.frame(i * 900);
    assert.equal(run.hook.playing, true);
    assert.ok(Math.abs(run.hook.beatsRef.current - (-4.2 + i)) < 1e-9, "beats use input time despite slower animation delivery");
  }
  run.cleanup();
});

test("switching from pending audible startup to silent preview invalidates the late audio continuation", async () => {
  const resume = deferred();
  const run = setup({ previewResume() { return resume.promise.then(() => { this.state = "running"; }); } });
  const audibleStart = run.hook.start();
  const preview = run.nativeContexts[0];
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  assert.equal(preview.closeCalls, 1);
  resume.resolve();
  await audibleStart;
  assert.equal(run.calls.setContext.length, 0);
  assert.equal(run.voices.length, 0);
  run.frame(500);
  assert.equal(run.hook.beatsRef.current, -3);
  run.cleanup();
});

test("connecting an input stops silent preview before a new scored clock starts", async () => {
  const run = setup();
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  run.frame(500);
  const input = audioContext({ time: 30 });
  run.setInput(input);
  assert.equal(run.hook.playing, false);
  assert.equal(run.frames.size, 0);
  assert.equal(input.resumeCalls, 0);
  await run.hook.start();
  assert.equal(input.resumeCalls, 1);
  assert.equal(run.hook.playing, true);
  assert.equal(run.toneContext, input);
  input.currentTime = 32.1;
  run.frame(1000);
  assert.ok(Math.abs(run.hook.beatsRef.current) < 1e-9);
  run.cleanup();
  assert.equal(input.closeCalls, 0);
});

for (const silent of [false, true]) {
  test(`a queued ${silent ? "silent" : "audio"} animation callback cannot restart work after synchronous stop`, async () => {
    const run = setup();
    await run.hook.start({ silent });
    assert.equal(run.hook.playing, true);
    const queued = [...run.frames.values()][0];
    assert.equal(typeof queued, "function");
    run.hook.stop();
    run.frames.clear();
    queued(500); // Dispatch already queued before React commits the stop and cleans up its effect.
    assert.equal(run.frames.size, 0);
    assert.equal(run.hook.error, null);
    assert.equal(run.hook.playing, false);
    run.cleanup();
  });
}

test("stopping silent preview and changing tempo in the same event cannot touch the audio clock", async () => {
  const run = setup();
  await run.hook.start({ silent: true });
  assert.equal(run.hook.playing, true);
  run.frame(500);
  const setBpmBeforeCommit = run.hook.setBpm;
  run.hook.stop();
  setBpmBeforeCommit(100);
  assert.equal(run.transports.size, 0, "the stopped visual clock must not switch to Tone before React rerenders");
  assert.equal(run.hook.bpm, 100);
  assert.equal(run.hook.playing, false);
  assert.equal(run.hook.beatsAt(.5), -3, "a stopped run's beat history is not rewritten with Tone time");
  assert.equal(run.hook.error, null);
  run.cleanup();
});
