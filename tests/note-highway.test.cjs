/* eslint-disable @typescript-eslint/no-require-imports -- Pure lesson engine tests use the repository TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HighwayGame, createHighwayPattern } = require("../src/lib/lesson/noteHighway");
const { GUITAR_STANDARD, BASS_STANDARD } = require("../src/lib/instrument/profile");

function note(id, midi, offset = 0) {
  return { id, t: id / 10, midi, midiFloat: midi + offset, cents: offset * 100,
    hz: 440 * 2 ** ((midi + offset - 69) / 12), confidence: .99, strength: .8, kind: "pluck" };
}

function pattern(notes = [{ beat: 0, midi: 40 }, { beat: 1, midi: 43 }, { beat: 2, midi: 45 }, { beat: 3, midi: 47 }], lengthBeats = 4) {
  return { name: "Test", notes: notes.map(n => ({ string: 0, fret: n.midi - 40, ...n })), lengthBeats };
}

test("standard guitar and bass create the specified one-note-per-beat E-minor run", () => {
  for (const [profile, frets, pitches] of [
    [GUITAR_STANDARD, [0, 3, 0, 2, 0, 2, 0, 2, 0, 3, 0, 3], [40, 43, 45, 47, 50, 52, 55, 57, 59, 62, 64, 67]],
    [BASS_STANDARD, [0, 3, 0, 2, 0, 2, 0, 2], [28, 31, 33, 35, 38, 40, 43, 45]],
  ]) {
    const run = createHighwayPattern(profile);
    assert.equal(run.name, "E minor run");
    assert.equal(run.lengthBeats, profile.stringCount * 2);
    assert.deepEqual(run.notes.map(n => n.beat), frets.map((_, i) => i));
    assert.deepEqual(run.notes.map(n => n.string), frets.map((_, i) => Math.floor(i / 2)));
    assert.deepEqual(run.notes.map(n => n.fret), frets);
    assert.deepEqual(run.notes.map(n => n.midi), pitches);
  }
});

test("render queries loop with stable IDs, use half-open boundaries, and expose copies", () => {
  const input = pattern();
  const game = new HighwayGame(input);
  input.notes[0].midi = 90;
  assert.deepEqual(game.notesBetween(-4, 0), []);
  const first = game.notesBetween(0, 4);
  assert.deepEqual(first.map(n => n.id), [0, 1, 2, 3]);
  assert.deepEqual(first.map(n => n.state), ["pending", "pending", "pending", "pending"]);
  assert.equal(first[0].midi, 40, "constructor isolates caller mutation");
  first[0].midi = 120;
  assert.equal(game.notesBetween(0, 1)[0].midi, 40);
  assert.deepEqual(game.notesBetween(3, 6).map(n => [n.id, n.beat, n.midi]), [[3, 3, 47], [4, 4, 40], [5, 5, 43]]);
  assert.equal(game.notesBetween(0, 1e6).length, 128);
  assert.deepEqual(game.notesBetween(1, 1), []);
});

test("perfect and good timing windows are measured in seconds across tempos", () => {
  for (const bpm of [60, 120, 240]) {
    for (const [seconds, expected] of [[0, "perfect"], [.09, "perfect"], [.091, "good"], [.22, "good"], [.221, "wrong"]]) {
      const game = new HighwayGame(pattern([{ beat: 2, midi: 40 }], 8));
      assert.equal(game.onNote(note(1, 40), 2 + seconds * bpm / 60, bpm).kind, expected);
    }
    for (const [seconds, expected] of [[-.09, "perfect"], [-.1, "good"], [-.22, "good"], [-.221, "wrong"]]) {
      const game = new HighwayGame(pattern([{ beat: 2, midi: 40 }], 8));
      assert.equal(game.onNote(note(1, 40), 2 + seconds * bpm / 60, bpm).kind, expected);
    }
  }
});

test("hits require exact MIDI and pitch tolerance; wrong notes do not consume the target", () => {
  const game = new HighwayGame(pattern());
  assert.equal(game.onNote(note(1, 52), 0, 120).kind, "wrong", "octave errors are not accepted");
  assert.equal(game.onNote(note(2, 40, .36), .05, 120).kind, "wrong");
  assert.equal(game.notesBetween(0, 1)[0].state, "pending");
  assert.equal(game.onNote(note(3, 40, -.35), .1, 120).kind, "perfect");
  assert.equal(game.notesBetween(0, 1)[0].state, "perfect");
  assert.equal(game.summary().hits, 1);
  assert.equal(game.summary().wrong, 2);
  assert.ok(Math.abs(game.summary().accuracy - 100 / 3) < 1e-9);
});

test("overlapping windows match the nearest pitch-compatible target, with earlier-target ties", () => {
  const game = new HighwayGame(pattern());
  const hit = game.onNote(note(1, 43), .45, 200);
  assert.equal(hit.kind, "good");
  assert.equal(hit.noteId, 1, "a G2 within its timing window is not blocked by the closer E2 target");
  assert.equal(game.notesBetween(0, 2)[0].state, "pending");
  assert.equal(game.notesBetween(0, 2)[1].state, "good");
  const samePitch = new HighwayGame(pattern([{ beat: 0, midi: 40 }, { beat: 1, midi: 40 }], 4));
  assert.equal(samePitch.onNote(note(1, 40), .5, 180).noteId, 0, "equally close matching targets choose the earlier one");
  const wrong = new HighwayGame(pattern()).onNote(note(1, 50), .5, 180);
  assert.equal(wrong.kind, "wrong");
  assert.equal(wrong.noteId, 0, "a wrong pitch associates with the nearest temporal target");
});

test("physical onset beats score despite delivery delay, until the final miss grace expires", () => {
  const game = new HighwayGame(pattern());
  game.advance(.8, 120); // 400 ms after beat zero: outside hit timing but still inside delivery grace.
  assert.equal(game.summary().misses, 0);
  assert.equal(game.onNote(note(1, 40), 0, 120).kind, "perfect");
  game.advance(.94, 120);
  assert.equal(game.summary().misses, 0);
  game.advance(1, 120);
  assert.equal(game.summary().misses, 0, "a hit inside grace cannot later turn into a miss");
  const missed = new HighwayGame(pattern());
  missed.advance(.94, 120);
  assert.equal(missed.summary().misses, 0);
  missed.advance(.941, 120);
  assert.equal(missed.summary().misses, 1);
  assert.deepEqual(missed.summary().feedback, { kind: "miss", beat: .941, noteId: 0 }, "the miss appears when finalized, not at its expired target time");
  assert.equal(missed.notesBetween(0, 1)[0].state, "miss");
  assert.equal(missed.onNote(note(1, 40), 0, 120).kind, "wrong");
  assert.equal(missed.summary().hits, 0, "a finalized miss cannot be revived by old input");
});

test("count-in and duplicate or older event IDs cannot score, including after history pruning", () => {
  const game = new HighwayGame(pattern());
  game.advance(-4, 120);
  assert.equal(game.onNote(note(1, 40), -.01, 120), null);
  assert.equal(game.onNote(note(1, 40), 0, 120), null, "count-in input cannot replay after the start line");
  assert.equal(game.onNote(note(2, 40), 0, 120).kind, "perfect");
  assert.equal(game.onNote(note(2, 43), 1, 120), null);
  assert.equal(game.onNote(note(1, 43), 1, 120), null);
  game.advance(1000000, 120);
  const before = game.summary();
  assert.equal(game.onNote(note(2, 40), 1000000, 120), null);
  assert.deepEqual(game.summary(), before);
});

test("summary tracks score, streaks, misses, accuracy and independent returned objects", () => {
  const game = new HighwayGame(pattern());
  assert.deepEqual(game.summary(), { score: 0, hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, accuracy: 0, feedback: null });
  game.onNote(note(1, 40), 0, 120);
  game.onNote(note(2, 43), 1.3, 120);
  assert.equal(game.summary().streak, 2);
  assert.equal(game.summary().bestStreak, 2);
  assert.equal(game.summary().score, 160);
  game.onNote(note(3, 48), 2, 120);
  assert.equal(game.summary().streak, 0);
  game.advance(3, 120);
  const summary = game.summary();
  assert.equal(summary.misses, 1);
  assert.equal(summary.wrong, 1);
  assert.equal(summary.accuracy, 50);
  assert.equal(summary.feedback.kind, "miss");
  summary.feedback.kind = "perfect";
  summary.score = 9000;
  assert.equal(game.summary().feedback.kind, "miss");
  assert.equal(game.summary().score, 160);
});

test("a skipped target breaks the combo immediately and its delayed miss preserves a later hit", () => {
  const game = new HighwayGame(pattern());
  game.onNote(note(1, 40), 0, 120);
  game.onNote(note(2, 45), 1.6, 120); // Target 2 played 200 ms early, before target 1's miss deadline.
  assert.equal(game.summary().streak, 1);
  assert.equal(game.summary().bestStreak, 1);
  game.advance(2, 120);
  assert.equal(game.summary().misses, 1);
  assert.equal(game.summary().streak, 1);
  game.onNote(note(3, 47), 3, 120);
  assert.equal(game.summary().streak, 2);
});

test("long idle jumps count misses arithmetically and keep render and judgment history bounded", () => {
  const game = new HighwayGame(createHighwayPattern(GUITAR_STANDARD));
  game.onNote(note(1, 40), 0, 120);
  game.onNote(note(2, 43), 1, 120);
  game.advance(1e9, 120);
  assert.equal(game.summary().misses, 1e9 - 2);
  assert.equal(game.summary().hits, 2);
  assert.deepEqual(game.notesBetween(0, 10), [], "pruned results are omitted instead of falsely shown as misses");
  assert.equal(game.notesBetween(1e9 - 200, 1e9).length, 128);
  assert.ok(game.notesBetween(1e9 - 2, 1e9).every(n => n.state === "miss"));
  assert.ok(game.hitsById.size <= 128);
  const before = game.summary();
  game.advance(0, 120);
  assert.deepEqual(game.summary(), before, "clock rewind requires reset");
});

test("sustained dense play stays bounded without losing hit accounting", () => {
  const dense = pattern(Array.from({ length: 16 }, (_, i) => ({ beat: i / 8, midi: 40 + i % 4 })), 2);
  const game = new HighwayGame(dense);
  for (let i = 0; i < 1000; i++) {
    const feedback = game.onNote(note(i, 40 + i % 4), i / 8, 600);
    assert.equal(feedback.kind, "perfect");
    assert.ok(game.hitsById.size <= 128);
  }
  game.advance(130, 600);
  assert.equal(game.summary().hits, 1000);
  assert.equal(game.summary().misses, 3, "only the three unplayed notes before the grace cutoff are misses");
});

test("reset clears scoring, timing, history and the event guard for a new run", () => {
  const game = new HighwayGame(pattern());
  game.onNote(note(10, 40), 0, 120);
  game.advance(100, 120);
  game.reset();
  assert.equal(game.summary().score, 0);
  assert.equal(game.summary().misses, 0);
  assert.equal(game.summary().feedback, null);
  assert.equal(game.notesBetween(0, 1)[0].state, "pending");
  assert.equal(game.onNote(note(1, 40), 0, 120).kind, "perfect");
});

test("malformed patterns and nonfinite or unsafe playback input cannot corrupt state", () => {
  for (const bad of [null, pattern([], 4), pattern(undefined, 0), pattern(undefined, Infinity),
    pattern([{ beat: 0, midi: 40 }, { beat: .01, midi: 43 }]), pattern([{ beat: 0, midi: 40 }, { beat: 3.99, midi: 40 }], 4),
    pattern([{ beat: NaN, midi: 40 }]), pattern([{ beat: 0, midi: 128 }]), pattern([{ beat: 0, midi: 40, fret: -1 }]),
    pattern(Array.from({ length: 129 }, (_, beat) => ({ beat, midi: 40 })), 130)]) {
    assert.throws(() => new HighwayGame(bad));
  }
  assert.throws(() => createHighwayPattern({ ...GUITAR_STANDARD, tuning: [NaN] }));
  const game = new HighwayGame(pattern());
  const initial = game.summary();
  for (const beat of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    game.advance(beat, 120);
    assert.equal(game.onNote(note(1, 40), beat, 120), null);
    assert.deepEqual(game.notesBetween(0, beat), []);
  }
  for (const bpm of [0, -1, NaN, Infinity, 601]) {
    game.advance(10, bpm);
    assert.equal(game.onNote(note(1, 40), 0, bpm), null);
  }
  for (const changes of [{ id: NaN }, { id: 1.5 }, { id: -1 }, { t: Infinity }, { midiFloat: NaN }, { midi: 128 },
    { confidence: NaN }, { strength: Infinity }, { hz: 0 }, { cents: Infinity }]) {
    assert.equal(game.onNote({ ...note(1, 40), ...changes }, 0, 120), null);
  }
  assert.deepEqual(game.summary(), initial);
  assert.equal(game.onNote(note(1, 40), 0, 120).kind, "perfect");
});
