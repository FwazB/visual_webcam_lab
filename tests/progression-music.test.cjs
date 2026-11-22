/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS tests use the repository's TypeScript require hook. */
const test = require("node:test");
const assert = require("node:assert/strict");

const { KEYS, MOODS, getProgression, nextVariation } = require("../src/lib/progressions/music");
const { GUITAR_STANDARD, BASS_STANDARD } = require("../src/lib/instrument/profile");

const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const letters = Object.keys(natural);
const majorScale = [0, 2, 4, 5, 7, 9, 11];
const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
const pitchClass = n => ((n % 12) + 12) % 12;

function notePitch(name) {
  assert.match(name, /^[A-G](♭{0,2}|♯{0,2})$/);
  return pitchClass(natural[name[0]] + [...name.slice(1)].reduce((n, sign) => n + (sign === "♯" ? 1 : -1), 0));
}

function allVariations(id) {
  const variations = [];
  let index = 0;
  do {
    assert.ok(!variations.includes(index) && variations.length < 20);
    variations.push(index);
    index = nextVariation(id, index, () => 0);
  } while (index !== 0);
  return variations;
}

function checkHand(chord, profile) {
  assert.equal(chord.strings.length, profile.stringCount);
  const byFinger = new Map();
  const played = [];
  const fretted = [];
  chord.strings.forEach(({ fret, finger, midi }, index) => {
    if (fret === null) {
      assert.equal(midi, null);
      assert.equal(finger, null);
      return;
    }
    assert.ok(Number.isInteger(fret) && fret >= 0 && fret <= profile.fretCount);
    assert.equal(midi, profile.tuning[index] + fret);
    played.push(midi);
    if (fret === 0) {
      assert.equal(finger, null);
    } else {
      assert.ok(Number.isInteger(finger) && finger >= 1 && finger <= 4);
      if (!byFinger.has(finger)) byFinger.set(finger, []);
      byFinger.get(finger).push(index);
      fretted.push(fret);
    }
  });
  assert.ok(Math.max(...fretted) - Math.min(...fretted) <= 3);
  for (const [finger, strings] of byFinger) {
    if (strings.length > 1) {
      assert.equal(chord.barre?.finger, finger);
      assert.equal(chord.barre.from, strings[0]);
      assert.equal(chord.barre.to, strings.at(-1));
      assert.ok(strings.every(i => chord.strings[i].fret === chord.barre.fret));
    }
  }
  if (chord.barre) {
    const { from, to, finger, fret } = chord.barre;
    assert.ok(to > from && byFinger.get(finger)?.length >= 2);
    for (let i = from; i <= to; i++) {
      assert.ok(chord.strings[i].fret >= fret);
      if (chord.strings[i].fret === fret) assert.equal(chord.strings[i].finger, finger);
    }
  }
  return played;
}

test("all recipes voice the spelled root, third and fifth in every key on both instruments", () => {
  assert.deepEqual(KEYS.map(k => k.value), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(MOODS.length, 4);
  const differentRecipes = new Set();
  for (const mood of MOODS) {
    const variations = allVariations(mood.id);
    assert.ok(variations.length >= 3);
    for (const variation of variations) {
      const numerals = getProgression(0, mood.id, variation, "guitar").map(c => c.numeral);
      const sequence = numerals.join(" ");
      assert.ok(!differentRecipes.has(sequence), sequence);
      differentRecipes.add(sequence);
      for (const { value: key, label } of KEYS) {
        assert.equal(notePitch(label), key);
        for (const [instrument, profile] of [["guitar", GUITAR_STANDARD], ["bass", BASS_STANDARD]]) {
          const chords = getProgression(key, mood.id, variation, instrument);
          assert.deepEqual(chords.map(c => c.numeral), numerals);
          assert.equal(chords.length, 4);
          for (const chord of chords) {
            const numeral = chord.numeral.replace("♭", "");
            const degree = roman.indexOf(numeral.toUpperCase());
            assert.ok(degree >= 0);
            const root = pitchClass(key + majorScale[degree] - Number(chord.numeral.startsWith("♭")));
            const minor = numeral === numeral.toLowerCase();
            const expected = [root, pitchClass(root + (minor ? 3 : 4)), pitchClass(root + 7)];
            assert.deepEqual(chord.notes.map(notePitch), expected);
            assert.deepEqual(chord.notes.map(note => note[0]), [0, 2, 4].map(
              step => letters[(letters.indexOf(label[0]) + degree + step) % 7]));
            assert.equal(chord.name, chord.notes[0] + (minor ? "m" : ""));
            const played = checkHand(chord, profile);
            assert.deepEqual(new Set(played.map(pitchClass)), new Set(expected));
            assert.equal(pitchClass(played[0]), root);
            if (instrument === "bass") {
              assert.equal(played.length, 3);
              assert.equal(played[1] - played[0], 7);
              assert.equal(played[2] - played[0], minor ? 15 : 16);
              assert.ok(chord.strings.filter(s => s.fret !== null).every(s => s.fret >= 5));
            } else {
              assert.ok(played.length >= 4);
            }
          }
        }
      }
    }
  }
});

test("default grips are recognizable and borrowed chords keep their diatonic letters", () => {
  const initial = getProgression(0, MOODS[0].id, 0, "guitar");
  assert.deepEqual(initial.map(c => c.name), ["C", "Am", "F", "G"]);
  assert.deepEqual(initial[0].strings.map(s => s.fret), [null, 3, 2, 0, 1, 0]);
  assert.deepEqual(initial[2].barre, { fret: 1, from: 4, to: 5, finger: 1 });
  assert.deepEqual(getProgression(1, "driving", 0, "bass")[1].notes, ["C♭", "E♭", "G♭"]);
  assert.deepEqual(getProgression(6, "bright", 0, "guitar")[3].notes, ["C♯", "E♯", "G♯"]);
});

test("a new variation reaches every alternative without immediately repeating", () => {
  for (const { id } of MOODS) {
    const variants = allVariations(id);
    for (const current of variants) {
      const alternatives = new Set();
      for (let i = 0; i < 100; i++) {
        alternatives.add(nextVariation(id, current, () => i / 100));
      }
      assert.deepEqual(alternatives, new Set(variants.filter(i => i !== current)));
    }
  }
});
