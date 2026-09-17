/* eslint-disable @typescript-eslint/no-require-imports -- Runs in Node's CommonJS test runner with tests/register.cjs. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BeatClock } = require("../src/lib/lesson/beatClock");
const { SongScorer, chartPositionAt } = require("../src/lib/lesson/songPlayer");
const { YUKON } = require("../src/lib/lesson/songs");
const { GUITAR_STANDARD } = require("../src/lib/instrument/profile");
const { configureHumFilter } = require("../src/lib/audio/inputFilter");

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const note = (midi) => ({ id: 1, t: 0, tPerf: 0, midi, midiFloat: midi, cents: 0, hz: 440, confidence: 1, strength: 1, kind: "pluck" });

test("tempo edits preserve the beat and the times of delayed notes", () => {
  const clock = new BeatClock();
  clock.start(5, 96, 4);
  near(clock.beatsAt(5), -4);
  near(clock.beatsAt(7.5), 0);
  near(clock.beatsAt(15), 12);
  clock.setTempo(15, 120);
  near(clock.beatsAt(15), 12);
  near(clock.beatsAt(16), 14);
  near(clock.beatsAt(14), 10.4);
  clock.setTempo(17, 60);
  near(clock.beatsAt(18), 17);
  near(clock.beatsAt(16), 14);
});

test("scheduled tempo edits do not move the clock before their audio time", () => {
  const clock = new BeatClock();
  clock.start(0, 120, 4);
  clock.setTempo(2.1, 60);
  near(clock.beatsAt(2), 0);
  near(clock.beatsAt(2.2), 0.3);
  clock.start(20, 96, 4);
  near(clock.beatsAt(22.5), 0);
});

test("disabled hum filter is transparent across the instrument range", () => {
  const filter = { type: "notch", frequency: { value: 60 }, Q: { value: 0.0001 }, gain: { value: 0 } };
  configureHumFilter(filter, false);
  // RBJ peaking-filter coefficients: numerator equals denominator at zero gain.
  // Check frequency response, including the 60 Hz center, instead of merely
  // asserting the selected filter type.
  function response(hz) {
    const w0 = 2 * Math.PI * filter.frequency.value / 48000;
    const alpha = Math.sin(w0) / (2 * filter.Q.value);
    const a = 10 ** (filter.gain.value / 40);
    const numerator = filter.type === "peaking"
      ? [1 + alpha * a, -2 * Math.cos(w0), 1 - alpha * a]
      : [1, -2 * Math.cos(w0), 1];
    const denominator = [1 + alpha / a, -2 * Math.cos(w0), 1 - alpha / a];
    const w = 2 * Math.PI * hz / 48000;
    const magnitude = (v) => Math.hypot(v[0] + v[1] * Math.cos(w) + v[2] * Math.cos(2 * w), -v[1] * Math.sin(w) - v[2] * Math.sin(2 * w));
    return magnitude(numerator) / magnitude(denominator);
  }
  for (const hz of [30, 41.2, 60, 82.4, 110, 220, 440, 1500]) near(response(hz), 1);
  configureHumFilter(filter, true);
  assert.ok(response(60) < 0.000001);
  assert.ok(response(82.4) > 0.99);
  configureHumFilter(filter, false);
  near(response(60), 1);
});

test("count-in notes do not create or score a chord slot", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  scorer.tick(chartPositionAt(YUKON, -1));
  scorer.onNote(note(60), chartPositionAt(YUKON, -0.1));
  assert.equal(scorer.summary().current, null);
  scorer.tick(chartPositionAt(YUKON, 0));
  assert.equal(scorer.summary().current.notes, 0);
});

test("anticipated chord tones survive the next render tick and score in the upcoming chord", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  scorer.tick(chartPositionAt(YUKON, 3.7));
  assert.equal(scorer.onNote(note(62), chartPositionAt(YUKON, 3.9)).chordTone, true);
  assert.equal(scorer.summary().current.chordId, "c9sus4");
  assert.equal(scorer.summary().current.notes, 0);
  scorer.tick(chartPositionAt(YUKON, 4.1));
  assert.equal(scorer.summary().current.chordId, "dm7");
  assert.ok(scorer.summary().current.tonesHit.has(2));
  assert.equal(scorer.summary().current.notes, 1);
});

test("notes can arrive before a render and late notes update their original slot", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  scorer.onNote(note(60), chartPositionAt(YUKON, 0.01));
  assert.equal(scorer.summary().current.notes, 1);
  scorer.tick(chartPositionAt(YUKON, 4.1));
  // The audio worklet reports this onset after the visual clock changed chord.
  scorer.onNote(note(61), chartPositionAt(YUKON, 3.7));
  assert.equal(scorer.summary().wrongNotes, 1);
  assert.equal(scorer.summary().current.chordId, "dm7");
  assert.equal(scorer.summary().current.notes, 0);
});

test("loop-boundary anticipation and skipped quiet slots retain correct scores", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  scorer.onNote(note(60), chartPositionAt(YUKON, 11.9));
  scorer.tick(chartPositionAt(YUKON, 12.1));
  assert.equal(scorer.summary().slotsPlayed, 3);
  assert.equal(scorer.summary().current.loopIndex, 1);
  assert.ok(scorer.summary().current.tonesHit.has(0));
  scorer.tick(chartPositionAt(YUKON, 24.1));
  assert.equal(scorer.summary().slotsPlayed, 6);
  assert.equal(scorer.summary().current.notes, 0);
});

test("late wrong notes correct a streak already shown for a completed chord", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  for (const midi of [60, 65, 70, 74, 79]) scorer.onNote(note(midi), chartPositionAt(YUKON, 1));
  scorer.tick(chartPositionAt(YUKON, 4.1));
  assert.equal(scorer.summary().streak, 1);
  scorer.onNote(note(61), chartPositionAt(YUKON, 3.7));
  assert.equal(scorer.summary().streak, 0);
  assert.equal(scorer.summary().bestStreak, 0);
});

test("wrong notes are visible immediately without waiting for a chord change", () => {
  const scorer = new SongScorer(YUKON, GUITAR_STANDARD);
  scorer.onNote(note(61), chartPositionAt(YUKON, 1));
  assert.equal(scorer.summary().wrongNotes, 1);
  scorer.tick(chartPositionAt(YUKON, 4.1));
  assert.equal(scorer.summary().wrongNotes, 1);
});
