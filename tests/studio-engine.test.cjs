/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the engine with Web Audio test doubles. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StudioEngine } = require("../src/lib/studio/engine");
const { emptyProject } = require("../src/lib/studio/project");

function environment(t, options = {}) {
  const events = [], messages = [];
  const node = () => ({ gain: { value: 1 }, connect() { return this; }, disconnect() {} });
  const ctx = {
    state: options.state ?? "running", currentTime: 0, sampleRate: 48000, destination: {},
    audioWorklet: { async addModule() { events.push("module"); } },
    resume() { events.push("resume"); return options.resume ? options.resume(ctx) : Promise.resolve(); },
    close() { events.push("close"); this.state = "closed"; return Promise.resolve(); },
    createGain: node,
    createMediaStreamSource() { events.push("source"); return node(); },
  };
  const recorder = { disconnect() { events.push("disconnect-recorder"); }, port: {
    onmessage: null, postMessage: (message) => messages.push(message), close() { events.push("close-port"); },
  } };
  for (const [key, value] of Object.entries({ AudioContext: function () { return ctx; }, AudioWorkletNode: function () { return recorder; },
    window: { setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const stream = () => {
    const track = { readyState: "live", muted: false, enabled: true, stopped: 0,
      stop() { this.stopped++; this.readyState = "ended"; }, getSettings: () => ({}) };
    return { track, getAudioTracks: () => [track], getTracks: () => [track] };
  };
  return { ctx, recorder, events, messages, stream,
    emit(data) { recorder.port.onmessage?.({ data }); },
    generation: () => messages.filter((message) => message.type === "reset-meter").at(-1).generation,
  };
}

test("creation requests activation before loading the worklet without awaiting blocked autoplay", { timeout: 1000 }, async (t) => {
  const run = environment(t, { state: "suspended", resume: () => new Promise(() => {}) });
  const engine = await StudioEngine.create();
  assert.deepEqual(run.events.slice(0, 2), ["resume", "module"]);
  engine.close();
});

test("resume is invoked synchronously and transport refuses paused or closed audio", async (t) => {
  let release;
  const run = environment(t, { state: "suspended", resume: () => new Promise((resolve) => { release = resolve; }) });
  const engine = await StudioEngine.create();
  engine.attachInput(run.stream());
  const opts = { bpm: 96, beatsPerBar: 4, metronome: false };
  assert.throws(() => engine.play(0, emptyProject(), new Map(), opts), /paused/);
  assert.throws(() => engine.record(0, emptyProject(), new Map(), opts, 0, false), /paused/);
  const before = run.events.length;
  const pending = engine.resume();
  assert.equal(run.events[before], "resume");
  release();
  await assert.rejects(pending, /paused/);
  const resumed = engine.resume();
  run.ctx.state = "running";
  release();
  await resumed;
  engine.play(0, emptyProject(), new Map(), opts);
  assert.equal(engine.mode, "playing");
  engine.close();
  await assert.rejects(engine.resume(), /no longer open/);
  assert.throws(() => engine.play(0, emptyProject(), new Map(), opts), /no longer open/);
});

test("live input state and fresh per-channel meters reject old devices, paused audio and ended tracks", async (t) => {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const run = environment(t);
  const engine = await StudioEngine.create();
  const first = run.stream();
  engine.attachInput(first);
  assert.equal(engine.hasInput, true);
  const oldGeneration = run.generation();
  const level = { type: "level", peaks: [0, 0.5], rms: [0, 0.25], frame: 0 };
  run.emit({ ...level, generation: oldGeneration });
  assert.deepEqual(engine.getInputLevel(), { peaks: [0, 0.5], rms: [0, 0.25] });
  engine.getInputLevel().peaks[1] = 0;
  assert.equal(engine.getInputLevel().peaks[1], 0.5);
  first.track.muted = true;
  assert.equal(engine.inputMuted, true);
  assert.equal(engine.getInputLevel(), null);
  first.track.muted = false;
  first.track.enabled = false;
  assert.equal(engine.inputMuted, true);
  first.track.enabled = true;
  run.ctx.state = "suspended";
  assert.equal(engine.getInputLevel(), null);
  run.ctx.state = "running";
  now += 501;
  assert.equal(engine.getInputLevel(), null);
  run.emit({ ...level, generation: oldGeneration });
  run.ctx.currentTime = 1;
  assert.equal(engine.getInputLevel(), null, "queued old audio frames are not fresh levels");
  const second = run.stream();
  engine.attachInput(second);
  assert.equal(first.track.stopped, 1);
  run.emit({ ...level, frame: 48000, generation: oldGeneration });
  assert.equal(engine.getInputLevel(), null);
  run.emit({ ...level, frame: 48000, generation: run.generation() });
  assert.ok(engine.getInputLevel());
  second.track.readyState = "ended";
  assert.equal(engine.hasInput, false);
  assert.equal(engine.getInputLevel(), null);
  assert.throws(() => engine.record(0, emptyProject(), new Map(), { bpm: 96, beatsPerBar: 4, metronome: false }, 0, false), /Connect an input/);
  const handler = run.recorder.port.onmessage;
  engine.close();
  assert.equal(run.recorder.port.onmessage, null);
  assert.ok(run.events.includes("close-port"));
  handler({ data: { ...level, generation: run.generation() } });
  assert.equal(engine.getInputLevel(), null);
});

test("an already-ended input is rejected and released", async (t) => {
  const run = environment(t);
  const engine = await StudioEngine.create();
  const stream = run.stream();
  stream.track.readyState = "ended";
  assert.throws(() => engine.attachInput(stream), /disconnected/);
  assert.equal(stream.track.stopped, 1);
  assert.equal(engine.hasInput, false);
  engine.close();
});
