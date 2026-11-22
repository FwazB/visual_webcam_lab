/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads TypeScript through tests/register.cjs. */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  arrangeCustomSteps, createCustomProgression, customChordStep, deleteCustomProgression, listCustomProgressions,
  readCustomProgression, saveCustomProgression, storeCustomDraft,
} = require("../src/lib/progressions/custom");
const { getSongChord } = require("../src/lib/progressions/music");

function deviceStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
}

test("editing uses playable guitar and bass voicings for all 24 custom chords", () => {
  for (let root = 0; root < 12; root++) {
    for (const quality of ["major", "minor"]) {
      const chord = customChordStep({ root, quality, beats: 7 });
      assert.equal(chord.beats, 7);
      assert.equal(chord.numeral, "");
      for (const instrument of ["guitar", "bass"]) {
        const grip = getSongChord(chord, instrument, "advanced");
        const pitches = grip.strings.flatMap(string => string.midi === null ? [] : [(string.midi - root + 120) % 12]);
        assert.deepEqual([...new Set(pitches)].sort((a, b) => a - b), [0, quality === "major" ? 4 : 3, 7]);
      }
    }
  }
});

test("adding, moving and removing respects chord order, selection and the 1–16 step range", () => {
  const original = createCustomProgression().steps;
  assert.equal(arrangeCustomSteps(original, 0, "remove").steps, original);
  assert.equal(arrangeCustomSteps(original, 0, "earlier").steps, original);
  const added = arrangeCustomSteps(original, 0, "add");
  assert.equal(added.index, 1);
  added.steps[1].root = 5;
  assert.equal(original[0].root, 0);
  const moved = arrangeCustomSteps(added.steps, 1, "earlier");
  assert.deepEqual(moved.steps.map(step => step.root), [5, 0]);
  assert.equal(moved.index, 0);
  assert.deepEqual(arrangeCustomSteps(moved.steps, 0, "later").steps, added.steps);
  assert.deepEqual(arrangeCustomSteps(added.steps, 1, "remove"), { steps: original, index: 0 });
  const full = Array.from({ length: 16 }, () => original[0]);
  assert.equal(arrangeCustomSteps(full, 10, "add").steps, full);
});

test("drafts and named loops round-trip independently with tempo, updates and deletion", () => {
  const storage = deviceStorage();
  storage.setItem("other-project", "keep");
  assert.equal(readCustomProgression(storage), null);
  const loop = { name: "  Verse  ", bpm: 103, steps: [{ root: 6, quality: "minor", beats: 3 }] };
  storeCustomDraft(storage, loop);
  saveCustomProgression(storage, loop);
  saveCustomProgression(storage, { ...loop, name: "Bridge" });
  assert.deepEqual(listCustomProgressions(storage), ["Bridge", "Verse"]);
  assert.deepEqual(readCustomProgression(storage), loop);
  saveCustomProgression(storage, { ...loop, bpm: 150 });
  assert.deepEqual(readCustomProgression(storage, "Verse"), { ...loop, name: "Verse", bpm: 150 });
  assert.equal(readCustomProgression(storage, "Bridge").bpm, 103);
  deleteCustomProgression(storage, "Verse");
  assert.equal(readCustomProgression(storage, "Verse"), null);
  assert.equal(storage.getItem("other-project"), "keep");
  assert.deepEqual(readCustomProgression(storage), loop);
});

test("malformed local data is rejected without touching other saved loops or clearing the draft", () => {
  const storage = deviceStorage();
  const loop = createCustomProgression();
  saveCustomProgression(storage, { ...loop, name: "Chorus" });
  const invalid = [
    { ...loop, bpm: 0 }, { ...loop, steps: [] }, { ...loop, steps: Array(17).fill(loop.steps[0]) },
    ...[{ root: 12 }, { beats: -1 }, { beats: 1.5 }, { quality: "seventh" }].map(change => ({
      ...loop, steps: [{ ...loop.steps[0], ...change }],
    })),
  ];
  for (const draft of invalid) {
    storeCustomDraft(storage, draft);
    assert.throws(() => readCustomProgression(storage), /Invalid saved progression/);
  }
  const draftKey = storage.key(1);
  storage.setItem(draftKey, "{");
  assert.throws(() => readCustomProgression(storage), SyntaxError);
  assert.equal(storage.getItem(draftKey), "{");
  assert.deepEqual(listCustomProgressions(storage), ["Chorus"]);
  assert.equal(readCustomProgression(storage, "Chorus").name, "Chorus");
});
