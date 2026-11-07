/* eslint-disable @typescript-eslint/no-require-imports -- Node tests use the repository's TypeScript require hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readHeardMidi } = require("../src/lib/instrument/neckEvidence");

const frame = Object.freeze({ t: 2, hz: 110, midiFloat: 45, midi: 45, cents: 0, clarity: 0.95, rms: 0.1, db: -20 });
const hear = (overrides = {}) => readHeardMidi({ audioFrame: frame, audioAgeMs: 15,
  audioRunning: true, gateDb: -45, clarityThreshold: .8, ...overrides });

test("fresh heard pitch is independent of camera observations and lesson targets", () => {
  assert.equal(hear(), 45);
  assert.equal(hear({ candidates: [], handAgeMs: Infinity, lessonTarget: { midi: 50 } }), 45);
  assert.equal(hear({ audioFrame: { ...frame, midi: 46, midiFloat: 46, hz: 116.54 } }), 46);
});

test("missing, stopped, stale, future and nonfinite audio never produces a heard note", () => {
  for (const override of [{ audioFrame: null }, { audioRunning: false },
    ...[-1, 250.001, Infinity, -Infinity, NaN].map(audioAgeMs => ({ audioAgeMs }))]) {
    assert.equal(hear(override), null);
  }
  for (const audioAgeMs of [0, 250]) assert.equal(hear({ audioAgeMs }), 45);
});

test("audio gates accept their exact boundary and reject quiet or unclear frames", () => {
  assert.equal(hear({ audioFrame: { ...frame, db: -45, clarity: .8 } }), 45);
  for (const patch of [{ db: -45.001 }, { clarity: .799 }]) assert.equal(hear({ audioFrame: { ...frame, ...patch } }), null);
});

test("unvoiced, fractional and invalid audio values are rejected", () => {
  for (const patch of [{ midi: -1 }, { midi: 45.5 }, { hz: 0 }, { hz: -110 }]) assert.equal(hear({ audioFrame: { ...frame, ...patch } }), null);
  for (const field of Object.keys(frame)) {
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(hear({ audioFrame: { ...frame, [field]: value } }), null, `${field}=${value}`);
  }
  for (const field of ["gateDb", "clarityThreshold"]) {
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(hear({ [field]: value }), null);
  }
  assert.equal(hear({ audioFrame: { ...frame, midi: 0, midiFloat: 0, hz: 8.18 } }), 0);
  assert.equal(frame.midi, 45, "validation does not mutate its input");
});
