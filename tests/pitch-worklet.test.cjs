/* eslint-disable @typescript-eslint/no-require-imports -- Runs the production AudioWorklet in Node's isolated VM. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { NoteTracker } = require("../src/lib/audio/noteTracker");

const source = fs.readFileSync(require.resolve("../public/worklets/pitch-processor.js"), "utf8")
  .replace("export function mpm", "function mpm");

function runSignal(hz, amplitudeAt, seconds = 1) {
  const messages = [];
  let Processor;
  const context = {
    sampleRate: 48000,
    currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (message) => messages.push(message) }; } },
    registerProcessor: (_, ctor) => { Processor = ctor; },
  };
  vm.runInNewContext(source, context);
  const processor = new Processor();
  if (hz < 60) processor.port.onmessage({ data: { type: "config", profile: { fMin: 30, windowMs: 93 } } });
  for (let block = 0; block < Math.ceil(seconds * 48000 / 128); block++) {
    const samples = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const t = (block * 128 + i) / 48000;
      samples[i] = amplitudeAt(t) * Math.sin(2 * Math.PI * hz * t);
    }
    context.currentTime = block * 128 / 48000;
    processor.process([[samples]]);
  }
  return messages;
}

test("digital silence followed by a note produces one scored attack", () => {
  const messages = runSignal(440, (t) => t < 0.1 ? 0 : 0.4);
  assert.equal(messages.filter((m) => m.type === "onset").length, 1);
  const tracker = new NoteTracker({ gateDb: -45, clarityThreshold: 0.85, hopMs: 11.6 });
  const notes = messages.map((message) => tracker.handle(message).noteOn).filter(Boolean);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 69);
});

for (const hz of [41.2, 82.4, 110, 220]) {
  test(`a sustained ${hz} Hz note does not retrigger on each waveform cycle`, () => {
    const messages = runSignal(hz, (t) => t < 0.1 ? 0 : 0.4);
    assert.equal(messages.filter((m) => m.type === "onset").length, 1);
  });
}

test("a second pluck after silence produces a separate onset", () => {
  const messages = runSignal(82.4, (t) => t >= 0.1 && t < 0.35 || t >= 0.6 ? 0.4 : 0);
  assert.equal(messages.filter((m) => m.type === "onset").length, 2);
});

test("silence and sub-gate background noise do not produce onsets", () => {
  const messages = runSignal(82.4, (t) => t < 0.5 ? 0 : 0.0001);
  assert.equal(messages.filter((m) => m.type === "onset").length, 0);
});
