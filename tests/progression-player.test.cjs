/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads the production player through the TypeScript hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { IDLE_PLAYBACK, ProgressionPlayer } = require("../src/lib/progressions/player.ts");
const { midiToHz } = require("../src/lib/instrument/pitch.ts");

function audio(state = "running") {
  const oscillators = [];
  return {
    state, currentTime: 0, oscillators, destination: {},
    resume() { this.state = "running"; return Promise.resolve(); },
    close() { this.state = "closed"; this.onstatechange?.(); return Promise.resolve(); },
    createPeriodicWave(_, harmonics) { return harmonics; },
    createGain() {
      const levels = [];
      return {
        levels,
        gain: {
          setValueAtTime(level) { levels.push(level); },
          linearRampToValueAtTime(level) { levels.push(level); },
          exponentialRampToValueAtTime(level) { levels.push(level); },
        },
        connect(node) { this.output = node; return node; }, disconnect() {},
      };
    },
    createOscillator() {
      const osc = {
        frequency: { value: 0 }, disconnected: false,
        setPeriodicWave(wave) { this.wave = wave; },
        connect(node) { this.output = node; return node; }, disconnect() { this.disconnected = true; },
        start(time) { this.startTime = time; }, stop(time) { this.endTime = time; },
      };
      oscillators.push(osc);
      return osc;
    },
  };
}

function advanceAudio(t, ctx, until) {
  while (ctx.currentTime < until) {
    ctx.currentTime = Math.min(until, ctx.currentTime + 0.04);
    t.mock.timers.tick(40);
  }
}

test("standalone metronome ticks once per beat, follows tempo changes and stops cleanly", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(state => states.push(state), () => ctx);
  t.after(player.stop);
  player.toggleMetronome(120);
  assert.equal(states.at(-1).metronome, true);
  assert.equal(states.at(-1).playing, false);
  assert.equal(states.at(-1).activeIndex, null);
  assert.equal(ctx.oscillators.length, 1);
  const click = ctx.oscillators[0];
  assert.equal(click.output.output, ctx.destination);
  assert.ok(Math.max(...click.output.levels) > 0.01);
  assert.ok(click.endTime > click.startTime && click.endTime - click.startTime < 0.2);
  const origin = click.startTime;
  advanceAudio(t, ctx, origin + 1.46);
  assert.deepEqual(ctx.oscillators.map(o => o.startTime - origin).map(n => n.toFixed(6)), [
    "0.000000", "0.500000", "1.000000", "1.500000",
  ]);

  // The next beat is already queued. A tempo change must not sound it twice.
  player.setTempo(80);
  advanceAudio(t, ctx, origin + 4);
  const retimed = ctx.oscillators.filter(o => !o.disconnected && o.startTime > ctx.currentTime - 2.6);
  assert.ok(retimed.length >= 3);
  for (const [i, osc] of retimed.entries()) {
    if (i > 0) assert.ok(Math.abs(osc.startTime - retimed[i - 1].startTime - 0.75) < 1e-8);
  }

  // A suspended JS timer must skip the elapsed beats when it wakes.
  const beforeStall = ctx.oscillators.length;
  ctx.currentTime += 25;
  t.mock.timers.tick(40);
  assert.ok(ctx.oscillators.length - beforeStall <= 1);
  player.toggleMetronome(80);
  assert.deepEqual(states.at(-1), IDLE_PLAYBACK);
  assert.equal(ctx.state, "closed");
  const count = ctx.oscillators.length;
  advanceAudio(t, ctx, ctx.currentTime + 1);
  assert.equal(ctx.oscillators.length, count);
});

test("a chord preview and then a bass loop can join a standalone click without losing its beat", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(state => states.push(state), () => ctx);
  t.after(player.stop);
  player.toggleMetronome(120);
  const origin = ctx.oscillators[0].startTime;
  advanceAudio(t, ctx, origin + 0.2);
  player.preview([67], "guitar");
  const preview = ctx.oscillators.find(o => o.frequency.value === midiToHz(67));
  assert.ok(preview);
  preview.onended();
  assert.equal(ctx.state, "running");
  assert.equal(states.at(-1).metronome, true);

  player.play([[40], [41]], "bass", 120, 1, [2, 1]);
  advanceAudio(t, ctx, origin + 1.05);
  const bass = ctx.oscillators.filter(o => o.frequency.value === midiToHz(40) || o.frequency.value === midiToHz(41));
  const clicks = ctx.oscillators.filter(o => !o.wave && !o.disconnected);
  assert.deepEqual(bass.map(o => o.frequency.value), [41, 40].map(midiToHz));
  assert.equal(bass[0].startTime, clicks[1].startTime);
  assert.equal(bass[1].startTime, clicks[2].startTime);
  assert.equal(states.at(-1).playing, true);
  player.stopLoop();
  assert.equal(states.at(-1).playing, false);
  assert.equal(states.at(-1).metronome, true);
  advanceAudio(t, ctx, origin + 1.55);
  assert.ok(Math.abs(ctx.oscillators.at(-1).startTime - (origin + 1.5)) < 1e-8);
  assert.ok(!ctx.oscillators.at(-1).wave);
});

test("enabling and disabling the click during a loop preserves its selected chord and beat phase", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(state => states.push(state), () => ctx);
  t.after(player.stop);
  player.play([[38], [45]], "bass", 120, 1, [2, 1]);
  const origin = ctx.oscillators[0].startTime;
  advanceAudio(t, ctx, origin + 0.2);
  player.toggleMetronome(120);
  advanceAudio(t, ctx, origin + 1.05);
  const clicks = ctx.oscillators.filter(o => !o.wave && !o.disconnected);
  assert.equal(clicks.length, 2);
  assert.ok(Math.abs(clicks[0].startTime - (origin + 0.5)) < 1e-8);
  assert.ok(Math.abs(clicks[1].startTime - (origin + 1)) < 1e-8);
  const bass = ctx.oscillators.filter(o => o.wave);
  assert.deepEqual(bass.map(o => o.frequency.value), [45, 38].map(midiToHz));
  assert.equal(bass[1].startTime, clicks[0].startTime);
  player.toggleMetronome(120);
  assert.equal(states.at(-1).metronome, false);
  assert.equal(states.at(-1).playing, true);
  const startCount = ctx.oscillators.length;
  advanceAudio(t, ctx, origin + 1.55);
  assert.deepEqual(ctx.oscillators.slice(startCount).map(o => o.frequency.value), [midiToHz(45)]);
});

test("turning off a metronome waiting for mobile audio prevents late clicks", async t => {
  const ctx = audio("suspended");
  const states = [];
  const player = new ProgressionPlayer(state => states.push(state), () => ctx);
  t.after(player.stop);
  let finishResume;
  ctx.resume = () => new Promise(resolve => { finishResume = resolve; });
  player.toggleMetronome(84);
  assert.equal(states.at(-1).starting, true);
  player.toggleMetronome(84);
  finishResume();
  await Promise.resolve();
  assert.deepEqual(states.at(-1), IDLE_PLAYBACK);
  assert.equal(ctx.state, "closed");
  assert.deepEqual(ctx.oscillators, []);
});

test("loops the diagram pitches from the selected bar and highlights only at the four-beat boundary", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  t.after(player.stop);
  const shapes = [[48, 55], [67, 60, 64]];
  const original = structuredClone(shapes);
  player.play(shapes, "guitar", 120, 1);
  assert.deepEqual(shapes, original);
  assert.equal(states.at(-1).activeIndex, 1);
  assert.deepEqual(ctx.oscillators.map(o => o.frequency.value), [60, 64, 67].map(midiToHz));
  assert.ok(ctx.oscillators[0].startTime < ctx.oscillators[1].startTime);
  ctx.currentTime = 1.95;
  t.mock.timers.tick(40);
  assert.equal(states.at(-1).activeIndex, 1);
  assert.deepEqual(ctx.oscillators.slice(3).map(o => o.frequency.value), [48, 55].map(midiToHz));
  assert.equal(ctx.oscillators[3].startTime, ctx.oscillators[0].startTime + 2);
  ctx.currentTime = 2.05;
  t.mock.timers.tick(40);
  assert.equal(states.at(-1).activeIndex, 0);
  // After a long stall, skip whole missed bars instead of sounding them all at once.
  ctx.currentTime = 14.5;
  t.mock.timers.tick(40);
  assert.equal(ctx.oscillators.length, 7);
  player.stop();
  assert.ok(ctx.oscillators.every(o => o.disconnected));
  assert.equal(ctx.state, "closed");
  assert.equal(states.at(-1).playing, false);
});

test("replacing a loop with a bass preview disconnects queued notes and releases the context on natural end", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  player.play([[60, 64], [62]], "guitar", 100);
  ctx.currentTime = 2.35;
  t.mock.timers.tick(40);
  const loopVoices = ctx.oscillators.slice();
  player.preview([35, 42], "bass");
  assert.ok(loopVoices.every(o => o.disconnected));
  assert.deepEqual(states.at(-1), IDLE_PLAYBACK);
  const bass = ctx.oscillators.slice(loopVoices.length);
  assert.deepEqual(bass.map(o => o.frequency.value), [35, 42].map(midiToHz));
  assert.notDeepEqual(loopVoices[0].wave, bass[0].wave);
  assert.ok(bass[1].startTime - bass[0].startTime < loopVoices[1].startTime - loopVoices[0].startTime);
  bass[0].onended();
  assert.equal(ctx.state, "running");
  bass[1].onended();
  assert.equal(ctx.state, "closed");
  assert.equal(states.at(-1).error, null);
  t.mock.timers.tick(5000);
  assert.equal(ctx.oscillators.length, loopVoices.length + 2);
});

test("mixed chord durations start on the selected chord and repeat on absolute beat boundaries", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  t.after(player.stop);
  const bpm = 87;
  const secondsPerBeat = 60 / bpm;
  const beats = [8, 2, 4];
  player.play([[48], [50], [52]], "bass", bpm, 1, beats);
  beats[1] = 16; // Editor changes after Play cannot shift an already-started loop.
  const origin = ctx.oscillators[0].startTime;
  const boundary = (beat, from, to) => {
    const start = origin + beat * secondsPerBeat;
    ctx.currentTime = start - 0.05;
    t.mock.timers.tick(40);
    assert.equal(states.at(-1).activeIndex, from);
    assert.ok(Math.abs(ctx.oscillators.at(-1).startTime - start) < 1e-8);
    assert.equal(ctx.oscillators.at(-1).frequency.value, midiToHz([48, 50, 52][to]));
    ctx.currentTime = start;
    t.mock.timers.tick(40);
    assert.equal(states.at(-1).activeIndex, to);
  };
  assert.equal(states.at(-1).activeIndex, 1);
  boundary(2, 1, 2);
  boundary(6, 2, 0);
  boundary(14, 0, 1);
  boundary(16, 1, 2);
  const voicesBeforeStall = ctx.oscillators.length;
  boundary(14 * 300 + 6, 2, 0);
  // A stalled event loop can schedule the upcoming boundary but never a burst of missed chords.
  assert.equal(ctx.oscillators.length, voicesBeforeStall + 1);
});

test("song slots accept one to sixteen beats and use four beats for missing or invalid entries", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const ctx = audio();
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  t.after(player.stop);
  player.play([[36], [38], [40], [41], [43]], "bass", 120, 0, [1, 16, 0, 17]);
  const origin = ctx.oscillators[0].startTime;
  [1, 17, 21, 25, 29].forEach((beat, i) => {
    ctx.currentTime = origin + beat * 0.5;
    t.mock.timers.tick(40);
    assert.equal(states.at(-1).activeIndex, (i + 1) % 5);
  });
});

test("superseded and stopped audio-resume promises never start notes or replace a later error", async () => {
  const ctx = audio("suspended");
  const pending = [];
  ctx.resume = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  player.play([[60]], "guitar", 84);
  assert.deepEqual(states.at(-1), { ...IDLE_PLAYBACK, starting: true });
  player.preview([40], "bass");
  pending[1].reject(new Error("audio unavailable"));
  await Promise.resolve();
  const error = states.at(-1).error;
  assert.ok(error);
  pending[0].resolve();
  await Promise.resolve();
  assert.equal(states.at(-1).error, error);
  assert.equal(ctx.oscillators.length, 0);
  const next = audio("suspended");
  let resume;
  next.resume = () => new Promise(resolve => { resume = resolve; });
  const retry = new ProgressionPlayer(s => states.push(s), () => next);
  retry.play([[55]], "guitar", 84);
  retry.stop();
  resume();
  await Promise.resolve();
  assert.equal(next.oscillators.length, 0);
  assert.equal(next.state, "closed");
  assert.equal(states.at(-1).playing, false);
});

test("a stalled mobile start releases its session and a fresh tap can play", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const session = { type: "auto" };
  t.mock.getter(globalThis, "navigator", () => ({ audioSession: session }));
  const blocked = audio("suspended");
  let finishBlocked;
  blocked.resume = () => new Promise(resolve => { finishBlocked = resolve; });
  const ready = audio();
  const contexts = [blocked, ready];
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => {
    assert.equal(session.type, "playback");
    return contexts.shift();
  });
  t.after(player.stop);
  player.play([[33]], "bass", 60);
  assert.deepEqual(states.at(-1), { ...IDLE_PLAYBACK, starting: true });
  t.mock.timers.tick(4000);
  assert.match(states.at(-1).error, /try again/);
  assert.equal(states.at(-1).starting, false);
  assert.equal(blocked.state, "closed");
  assert.equal(session.type, "auto");

  player.preview([33], "bass");
  assert.equal(session.type, "playback");
  assert.equal(ready.oscillators.length, 1);
  finishBlocked();
  await Promise.resolve();
  assert.equal(blocked.oscillators.length, 0);
  assert.deepEqual(states.at(-1), IDLE_PLAYBACK);
  ready.oscillators[0].onended();
  assert.equal(session.type, "auto");
});

test("a delayed successful resume keeps playing past the startup timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const ctx = audio("suspended");
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  t.after(player.stop);
  player.play([[40]], "bass", 80);
  assert.equal(states.at(-1).starting, true);
  await Promise.resolve();
  t.mock.timers.tick(6000);
  assert.deepEqual(states.at(-1), { ...IDLE_PLAYBACK, playing: true, activeIndex: 0 });
  assert.equal(ctx.state, "running");
});

test("hidden tabs, pagehide and unmount each release the hook's audio", t => {
  const Module = require("node:module");
  const api = require("../src/lib/progressions/player.ts");
  const contexts = [];
  const page = new EventTarget();
  const doc = new EventTarget();
  t.mock.method(globalThis, "setInterval", () => 1);
  // Load the real hook with only React's mount and the Web Audio hardware replaced.
  const file = require.resolve("../src/hooks/useProgressionPlayer.ts");
  const hookModule = new Module(file, module);
  const cleanup = [];
  const react = {
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    useEffect(effect) { cleanup.push(effect()); },
  };
  class LocalPlayer extends ProgressionPlayer {
    constructor(update) { super(update, () => { const ctx = audio(); contexts.push(ctx); return ctx; }); }
  }
  hookModule.require = name => name === "react" ? react : { ...api, ProgressionPlayer: LocalPlayer };
  require.extensions[".ts"](hookModule, file);
  globalThis.window = page;
  globalThis.document = doc;
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const player = hookModule.exports.useProgressionPlayer();
  assert.equal(contexts.length, 0);
  player.play([[52]], "bass", 80);
  player.toggleMetronome(80);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(contexts[0].state, "running");
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(contexts[0].state, "closed");
  doc.hidden = false;
  player.preview([60], "guitar");
  page.dispatchEvent(new Event("pagehide"));
  assert.equal(contexts[1].state, "closed");
  player.preview([62], "guitar");
  cleanup[0]();
  assert.equal(contexts[2].state, "closed");
  assert.ok(contexts.every(ctx => ctx.oscillators.every(o => o.disconnected)));
});
