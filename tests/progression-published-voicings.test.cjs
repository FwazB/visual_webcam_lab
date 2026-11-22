/* eslint-disable @typescript-eslint/no-require-imports -- Node loads TypeScript through the repository's CommonJS test hook. */
const test = require("node:test");
const assert = require("node:assert/strict");

const { publishedFingering } = require("../src/lib/progressions/publishedVoicings");
const { getSongChord } = require("../src/lib/progressions/music");
const { BASS_STANDARD, GUITAR_STANDARD } = require("../src/lib/instrument/profile");

const roots = ["C", "C♯", "D♭", "D", "D♯", "E♭", "E", "F", "F♯", "G♭", "G", "G♯", "A♭", "A", "A♯", "B♭", "B"];
const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const mod = n => ((n % 12) + 12) % 12;
function pitch(note) {
  assert.match(note, /^[A-G](♭*|♯*)$/);
  return mod(naturals[note[0]] + [...note.slice(1)].reduce((n, sign) => n + (sign === "♯" ? 1 : -1), 0));
}

function checkHand(chord, profile) {
  assert.equal(chord.strings.length, profile.stringCount);
  const frets = [];
  const sounding = [];
  const fingers = new Map();
  chord.strings.forEach(({ fret, finger, midi }, index) => {
    if (fret === null) {
      assert.equal(finger, null);
      assert.equal(midi, null);
      return;
    }
    assert.ok(Number.isInteger(fret) && fret >= 0 && fret <= profile.fretCount);
    assert.equal(midi, profile.tuning[index] + fret);
    sounding.push(midi);
    if (fret === 0) {
      assert.equal(finger, null);
    } else {
      assert.ok(Number.isInteger(finger) && finger >= 1 && finger <= 4);
      frets.push(fret);
      if (!fingers.has(finger)) fingers.set(finger, []);
      fingers.get(finger).push(index);
    }
  });
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 3);
  assert.deepEqual([...sounding].sort((a, b) => a - b), sounding);

  for (const [finger, indexes] of fingers) {
    if (indexes.length === 1) continue;
    assert.deepEqual(chord.barre, {
      finger, fret: chord.strings[indexes[0]].fret, from: indexes[0], to: indexes.at(-1),
    });
    assert.ok(indexes.every(i => chord.strings[i].fret === chord.barre.fret));
    for (const string of chord.strings.slice(chord.barre.from, chord.barre.to + 1)) {
      assert.ok(string.fret !== null && string.fret >= chord.barre.fret);
    }
  }
  if (chord.barre) assert.ok(fingers.get(chord.barre.finger).length > 1);
  return sounding;
}

test("published voicings contain every written tone, with the root lowest and a feasible fingering", () => {
  const qualities = {
    "": [0, 4, 7], m: [0, 3, 7], 5: [0, 7], sus2: [0, 2, 7], sus4: [0, 5, 7],
    7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], add9: [0, 4, 7, 2],
    madd9: [0, 3, 7, 2], "7sus2": [0, 2, 7, 10], "7sus4": [0, 5, 7, 10],
    dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], mmaj7: [0, 3, 7, 11],
  };
  for (const [instrument, profile] of [["guitar", GUITAR_STANDARD], ["bass", BASS_STANDARD]]) {
    for (const root of roots) {
      for (const [quality, intervals] of Object.entries(qualities)) {
        const chord = publishedFingering(root + quality, instrument);
        assert.ok(chord, root + quality);
        assert.equal(chord.name, root + quality);
        const expected = intervals.map(i => mod(pitch(root) + i));
        assert.deepEqual(chord.notes.map(pitch), expected);
        const sounding = checkHand(chord, profile);
        assert.equal(mod(sounding[0]), pitch(root));
        assert.deepEqual(new Set(sounding.map(mod)), new Set(expected));
      }
    }
  }
});

test("chart spelling and supported aliases retain the symbol and the correct letter names", () => {
  assert.deepEqual(publishedFingering("Gbmaj7", "guitar").notes, ["G♭", "B♭", "D♭", "F"]);
  assert.deepEqual(publishedFingering("C#add9", "bass").notes, ["C♯", "E♯", "G♯", "D♯"]);
  assert.deepEqual(publishedFingering("Cdim7", "bass").notes, ["C", "E♭", "G♭", "B♭♭"]);
  assert.deepEqual(publishedFingering("A♭sus2", "guitar").notes, ["A♭", "B♭", "E♭"]);
  for (const instrument of ["guitar", "bass"]) {
    for (const suffix of ["", "maj", "min", "m"]) {
      const symbol = "D♭" + suffix;
      const quality = suffix === "m" || suffix === "min" ? "minor" : "major";
      assert.deepEqual(publishedFingering(symbol, instrument), getSongChord({
        name: symbol, root: 1, quality, numeral: "",
      }, instrument, "advanced"));
    }
    for (const [alias, canonical] of [["no3d", "5"], ["M7", "maj7"], ["min7", "m7"],
      ["sus", "sus4"], ["7sus", "7sus4"], ["m7♭5", "m7b5"], ["minmaj7", "mmaj7"]]) {
      const symbol = "F♯" + alias;
      assert.deepEqual(publishedFingering(symbol, instrument), {
        ...publishedFingering("F♯" + canonical, instrument), name: symbol,
      });
    }
  }
});

test("unrecognized extensions, inversions and malformed symbols keep their chart-only representation", () => {
  for (const symbol of ["C/E", "B♭/D", "D7/F♯", "Am/G", "Amaj9", "G9", "Fm11", "C7♭9",
    "C7(no5)", "N.C.", "H7", "Cwat", "Csus42", "C5/E", "C7\n", "Cconstructor", ""]) {
    for (const instrument of ["guitar", "bass"]) {
      assert.equal(publishedFingering(symbol, instrument), null, symbol);
    }
  }
});
