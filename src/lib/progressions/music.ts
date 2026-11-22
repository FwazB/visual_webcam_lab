import { BASS_STANDARD, GUITAR_STANDARD, midiAt } from "@/lib/instrument/profile";
import type { LevelId, SongStep } from "./songPath";

export type Instrument = "guitar" | "bass";
export type Chord = {
  name: string;
  numeral: string;
  notes: string[];
  strings: { fret: number | null; finger: number | null; midi: number | null }[];
  barre?: { fret: number; from: number; to: number; finger: number };
};

export const KEYS = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
  .map((label, value) => ({ label, value }));

// Scale degree is a letter offset from the tonic. Borrowing changes the pitch
// and chord quality while preserving that letter (e.g. ♭VII in D♭ is C♭).
const DEGREES = {
  I: [0, 0, "major"],
  ii: [1, 2, "minor"],
  "♭III": [2, 3, "major"],
  iii: [2, 4, "minor"],
  IV: [3, 5, "major"],
  iv: [3, 5, "minor"],
  V: [4, 7, "major"],
  vi: [5, 9, "minor"],
  "♭VII": [6, 10, "major"],
} as const;
type Numeral = keyof typeof DEGREES;
type Quality = SongStep["quality"];
type Recipe = readonly [Numeral, Numeral, Numeral, Numeral];

const FAMILIES: { id: string; label: string; recipes: Recipe[] }[] = [
  { id: "bright", label: "Bright", recipes: [
    ["I", "vi", "IV", "V"], ["I", "V", "vi", "IV"],
    ["I", "IV", "ii", "V"], ["IV", "V", "iii", "vi"],
  ] },
  { id: "wistful", label: "Wistful", recipes: [
    ["vi", "IV", "I", "iii"], ["vi", "ii", "IV", "V"],
    ["vi", "iii", "IV", "I"], ["vi", "V", "IV", "iii"],
  ] },
  { id: "driving", label: "Driving", recipes: [
    ["I", "♭VII", "IV", "I"], ["I", "IV", "♭VII", "V"],
    ["I", "♭III", "IV", "♭VII"], ["I", "♭VII", "♭III", "IV"],
  ] },
  { id: "dreamy", label: "Dreamy", recipes: [
    ["I", "iii", "IV", "iv"], ["IV", "iv", "I", "vi"],
    ["I", "ii", "IV", "iv"], ["IV", "vi", "iii", "I"],
  ] },
];
export const MOODS = FAMILIES.map(({ id, label }) => ({ id, label }));

function wrap(value: number, length: number) {
  return Number.isFinite(value) ? ((Math.trunc(value) % length) + length) % length : 0;
}

function recipesFor(mood: string) {
  return (FAMILIES.find(family => family.id === mood) ?? FAMILIES[0]).recipes;
}

export function nextVariation(mood: string, current: number, rng = Math.random): number {
  const count = recipesFor(mood).length;
  const offset = 1 + Math.floor(rng() * (count - 1));
  return wrap(current + offset, count);
}

const LETTERS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
function spell(letter: number, pitchClass: number) {
  const index = wrap(letter, 7);
  const accidental = wrap(pitchClass - NATURALS[index] + 6, 12) - 6;
  return LETTERS[index] + (accidental < 0 ? "♭" : "♯").repeat(Math.abs(accidental));
}

type Position = number | null;
type Shape = { frets: Position[]; fingers: Position[]; barre?: Chord["barre"] };

// The key is the root's pitch class. Open chords and the small F grip keep
// common first-position progressions playable without a full barre.
const OPEN_MAJOR: Partial<Record<number, Shape>> = {
  0: { frets: [null, 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] },
  2: { frets: [null, null, 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2] },
  4: { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null] },
  5: { frets: [null, null, 3, 2, 1, 1], fingers: [null, null, 3, 2, 1, 1],
       barre: { fret: 1, from: 4, to: 5, finger: 1 } },
  7: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3] },
  9: { frets: [null, 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null] },
};
const OPEN_MINOR: Partial<Record<number, Shape>> = {
  2: { frets: [null, null, 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1] },
  4: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null] },
  9: { frets: [null, 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null] },
};

function guitarShape(root: number, quality: Quality): Shape {
  const open = (quality === "major" ? OPEN_MAJOR : OPEN_MINOR)[root];
  if (open) return open;
  const e = wrap(root - GUITAR_STANDARD.tuning[0], 12);
  const a = wrap(root - GUITAR_STANDARD.tuning[1], 12);
  if (e < a) {
    const major = quality === "major";
    return {
      frets: [e, e + 2, e + 2, major ? e + 1 : e, e, e],
      fingers: [1, 3, 4, major ? 2 : 1, 1, 1],
      barre: { fret: e, from: 0, to: 5, finger: 1 },
    };
  }
  if (quality === "minor") {
    return {
      frets: [null, a, a + 2, a + 2, a + 1, a],
      fingers: [null, 1, 3, 4, 2, 1],
      barre: { fret: a, from: 1, to: 5, finger: 1 },
    };
  }
  // Mute the high E so the ring finger can lie flat across D, G and B.
  return {
    frets: [null, a, a + 2, a + 2, a + 2, null],
    fingers: [null, 1, 3, 3, 3, null],
    barre: { fret: a + 2, from: 2, to: 4, finger: 3 },
  };
}

function bassShape(root: number, quality: Quality, level: LevelId): Shape {
  if (level !== "advanced") {
    // Use the lowest octave, on the highest available open string. The root
    // stays within the first four frets and the fifth lies on the next string.
    const tuning = BASS_STANDARD.tuning;
    const midi = tuning[0] + wrap(root - tuning[0], 12);
    const string = tuning.findLastIndex(open => open <= midi);
    const fret = midi - tuning[string];
    const frets: Position[] = tuning.map(() => null);
    const fingers: Position[] = tuning.map(() => null);
    frets[string] = fret;
    fingers[string] = fret === 0 ? null : 1;
    if (level === "intermediate") {
      frets[string + 1] = midi + 7 - tuning[string + 1];
      fingers[string + 1] = fret === 0 ? 2 : 4;
    }
    return { frets, fingers };
  }
  // Root–fifth–tenth on E, A, G. Skipping the D string opens the upper
  // interval; fifth position and up keeps the full grip within two frets.
  const r = 5 + wrap(root - BASS_STANDARD.tuning[0] - 5, 12);
  return { frets: [r, r + 2, null, quality === "major" ? r + 1 : r],
           fingers: [1, 4, null, 2] };
}

export function getSongChord(step: Omit<SongStep, "beats">, instrument: Instrument, level: LevelId): Chord {
  const root = wrap(step.root, 12);
  const letter = LETTERS.indexOf(step.name[0]);
  const notes = [spell(letter, root), spell(letter + 2, root + (step.quality === "major" ? 4 : 3)),
                 spell(letter + 4, root + 7)];
  const profile = instrument === "bass" ? BASS_STANDARD : GUITAR_STANDARD;
  const shape = instrument === "bass" ? bassShape(root, step.quality, level) : guitarShape(root, step.quality);
  return {
    name: step.name, numeral: step.numeral, notes,
    strings: shape.frets.map((fret, index) => ({
      fret, finger: shape.fingers[index], midi: fret === null ? null : midiAt(profile, index, fret),
    })),
    ...(shape.barre && { barre: { ...shape.barre } }),
  };
}

export function getProgression(key: number, mood: string, variation: number, instrument: Instrument): Chord[] {
  const tonic = wrap(key, 12);
  const tonicLetter = LETTERS.indexOf(KEYS[tonic].label[0]);
  const recipes = recipesFor(mood);
  return recipes[wrap(variation, recipes.length)].map(numeral => {
    const [degree, semitones, quality] = DEGREES[numeral];
    const root = wrap(tonic + semitones, 12);
    const name = spell(tonicLetter + degree, root) + (quality === "minor" ? "m" : "");
    return getSongChord({ name, root, quality, numeral }, instrument, "advanced");
  });
}
