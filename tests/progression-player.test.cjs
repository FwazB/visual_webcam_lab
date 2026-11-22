/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads the production player through the TypeScript hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ProgressionPlayer } = require("../src/lib/progressions/player.ts");
const { midiToHz } = require("../src/lib/instrument/pitch.ts");

function audio(state = "running") {
  const oscillators = [];
  return {
    state, currentTime: 0, oscillators, destination: {},
    resume() { this.state = "running"; return Promise.resolve(); },
    close() { this.state = "closed"; this.onstatechange?.(); return Promise.resolve(); },
    createPeriodicWave(_, harmonics) { return harmonics; },
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect(node) { return node; }, disconnect() {},
      };
    },
    createOscillator() {
      const osc = {
        frequency: { value: 0 }, disconnected: false,
        setPeriodicWave(wave) { this.wave = wave; },
        connect(node) { return node; }, disconnect() { this.disconnected = true; },
        start(time) { this.startTime = time; }, stop(time) { this.endTime = time; },
      };
      oscillators.push(osc);
      return osc;
    },
  };
}

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
  assert.deepEqual(states.at(-1), { playing: false, activeIndex: null, error: null });
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

test("superseded and stopped audio-resume promises never start notes or replace a later error", async () => {
  const ctx = audio("suspended");
  const pending = [];
  ctx.resume = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const states = [];
  const player = new ProgressionPlayer(s => states.push(s), () => ctx);
  player.play([[60]], "guitar", 84);
  assert.equal(states.at(-1).playing, true);
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
