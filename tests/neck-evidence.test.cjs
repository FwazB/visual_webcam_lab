/* eslint-disable @typescript-eslint/no-require-imports -- Node tests use the repository's TypeScript require hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateNeckEvidence } = require("../src/lib/instrument/neckEvidence");

const lowEA = Object.freeze({ handIndex: 0, finger: 1, string: 0, fret: 5, midi: 45, point: Object.freeze({ x: 0.4, y: 0.3 }) });
const frame = Object.freeze({ t: 2, hz: 110, midiFloat: 45, midi: 45, cents: 0, clarity: 0.95, rms: 0.1, db: -20 });

function evaluate(overrides = {}) {
  return evaluateNeckEvidence({
    candidates: [lowEA], handAgeMs: 20, audioFrame: frame, audioAgeMs: 15,
    audioRunning: true, gateDb: -45, clarityThreshold: 0.8, ...overrides,
  });
}

test("one fresh position can agree or differ from heard pitch without establishing contact", () => {
  assert.deepEqual(evaluate(), { status: "agrees", candidates: [lowEA], heardMidi: 45 });
  assert.deepEqual(evaluate({ audioFrame: { ...frame, midi: 46, midiFloat: 46, hz: 116.54 } }), {
    status: "differs", candidates: [lowEA], heardMidi: 46,
  });
});

test("no visible candidates stays unseen even when a note is heard", () => {
  assert.deepEqual(evaluate({ candidates: [] }), { status: "unseen", candidates: [], heardMidi: 45 });
  assert.deepEqual(evaluate({ candidates: [], audioFrame: null }), { status: "unseen", candidates: [], heardMidi: null });
});

test("stale, future, and nonfinite hand ages discard positional evidence", () => {
  for (const handAgeMs of [-1, 250.001, Infinity, -Infinity, NaN]) {
    assert.deepEqual(evaluate({ handAgeMs }), { status: "unseen", candidates: [], heardMidi: 45 });
  }
  for (const handAgeMs of [0, 250]) {
    assert.equal(evaluate({ handAgeMs, audioAgeMs: handAgeMs }).status, "agrees");
  }
});

test("missing, stopped, stale, future, and nonfinite audio never confirms a visible position", () => {
  for (const override of [
    { audioFrame: null }, { audioRunning: false },
    ...[-1, 250.001, Infinity, -Infinity, NaN].map(audioAgeMs => ({ audioAgeMs })),
  ]) {
    assert.deepEqual(evaluate(override), { status: "visible", candidates: [lowEA], heardMidi: null });
  }
  for (const audioAgeMs of [0, 250]) {
    assert.equal(evaluate({ audioAgeMs, handAgeMs: audioAgeMs }).heardMidi, 45);
  }
});

test("audio gates accept their exact boundary and reject quiet or unclear frames", () => {
  assert.equal(evaluate({ audioFrame: { ...frame, db: -45, clarity: 0.8 } }).status, "agrees");
  for (const patch of [{ db: -45.001 }, { clarity: 0.799 }]) {
    assert.equal(evaluate({ audioFrame: { ...frame, ...patch } }).heardMidi, null);
  }
});

test("unvoiced, fractional, and invalid audio values are rejected", () => {
  for (const patch of [{ midi: -1 }, { midi: 45.5 }, { hz: 0 }, { hz: -110 }]) {
    assert.equal(evaluate({ audioFrame: { ...frame, ...patch } }).heardMidi, null);
  }
  for (const field of Object.keys(frame)) {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(evaluate({ audioFrame: { ...frame, [field]: value } }).heardMidi, null, `${field}=${value}`);
    }
  }
  for (const field of ["gateDb", "clarityThreshold"]) {
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(evaluate({ [field]: value }).heardMidi, null);
  }
  assert.equal(evaluate({ audioFrame: { ...frame, midi: 0, midiFloat: 0, hz: 8.18 } }).heardMidi, 0);
});

test("simultaneous distinct positions stay ambiguous with or without matching audio", () => {
  const other = { ...lowEA, finger: 2, string: 1, fret: 2, midi: 47 };
  const candidates = [lowEA, other];
  for (const audioFrame of [null, frame, { ...frame, midi: 47 }, { ...frame, midi: 50 }]) {
    const evidence = evaluate({ candidates, audioFrame });
    assert.equal(evidence.status, "ambiguous");
    assert.deepEqual(evidence.candidates, candidates);
  }
});

test("equal pitches at different neck positions cannot be resolved by audio or a lesson target", () => {
  const samePitchElsewhere = { ...lowEA, finger: 2, string: 1, fret: 0 };
  for (const lessonTarget of [lowEA, samePitchElsewhere]) {
    const evidence = evaluate({ candidates: [lowEA, samePitchElsewhere], lessonTarget });
    assert.equal(evidence.status, "ambiguous");
    assert.equal(evidence.heardMidi, 45);
  }
  assert.equal(evaluate({ lessonTarget: { ...lowEA, midi: 50 } }).status, "agrees");
  assert.equal(evaluate({ candidates: [{ ...lowEA, midi: 46 }], lessonTarget: lowEA }).status, "differs");
});

test("duplicate observations of one string and fret do not invent multiple positions", () => {
  const duplicate = { ...lowEA, handIndex: 1, finger: 2 };
  assert.equal(evaluate({ candidates: [lowEA, duplicate] }).status, "agrees");
  assert.equal(evaluate({ candidates: [lowEA, duplicate], audioFrame: null }).status, "visible");
});

test("fresh audio and hand frames must be close in time before comparison", () => {
  for (const [handAgeMs, audioAgeMs] of [[0, 150], [150, 0], [100, 250], [250, 100]]) {
    assert.equal(evaluate({ handAgeMs, audioAgeMs }).status, "agrees");
  }
  for (const [handAgeMs, audioAgeMs] of [[0, 150.001], [150.001, 0], [250, 0]]) {
    assert.equal(evaluate({ handAgeMs, audioAgeMs }).status, "unsynced");
  }
  const other = { ...lowEA, string: 1, fret: 0 };
  assert.equal(evaluate({ candidates: [lowEA, other], handAgeMs: 250, audioAgeMs: 0 }).status, "unsynced");
  assert.equal(evaluate({ handAgeMs: 250, audioAgeMs: 0, audioFrame: null }).status, "visible");
});

test("evaluation preserves the input candidates and returns a separate array", () => {
  const candidates = Object.freeze([lowEA]);
  const evidence = evaluate({ candidates });
  assert.notEqual(evidence.candidates, candidates);
  evidence.candidates.pop();
  assert.deepEqual(candidates, [lowEA]);
});
