// Bass music theory: notes, keys, intervals.
// Standard 4-string bass tuning (low to high): E1, A1, D2, G2.

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

// Open string MIDI-like pitch-class index (0 = C) for each string 0..3 (E, A, D, G).
// We only care about pitch class for labeling; octave isn't shown.
const OPEN_STRING_PC = [4, 9, 2, 7]; // E, A, D, G

/** Pitch class (0..11) for a given (string, fret). */
export function pitchClass(stringIdx: number, fret: number): number {
  return ((OPEN_STRING_PC[stringIdx] + fret) % 12 + 12) % 12;
}

/** Note name for (string, fret). */
export function noteAt(stringIdx: number, fret: number): NoteName {
  return NOTE_NAMES[pitchClass(stringIdx, fret)];
}

/** Find the first fret (0..11) on a given string where the pitch class matches. */
export function findRootFret(stringIdx: number, pc: number): number {
  const openPc = OPEN_STRING_PC[stringIdx];
  return ((pc - openPc) % 12 + 12) % 12;
}
