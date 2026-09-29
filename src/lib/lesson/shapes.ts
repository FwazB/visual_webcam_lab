// Shape library: transposable fretboard patterns.
// Positions are relative to the root; the root sits on the E string.

import { NOTE_NAMES } from "@/lib/instrument/pitch";
import { midiAt, type InstrumentProfile } from "@/lib/instrument/profile";
import { findRootFret } from "@/lib/instrument/positions";

type Role =
  | "R" | "b3" | "3" | "4" | "5" | "b7" | "7" | "8";

interface ShapePosition {
  /** Strings above the lowest (root) string. */
  stringOffset: number;
  /** Semitones from the root fret, interpreted as frets on the target string. */
  fretOffset: number;
  role: Role;
}

interface Shape {
  id: string;
  name: string;
  description: string;
  positions: ShapePosition[];
}

/** Shape library — ordered by lesson progression. */
export const SHAPES: Shape[] = [
  {
    id: "root",
    name: "Root",
    description: "Just the root note. Get oriented.",
    positions: [{ stringOffset: 0, fretOffset: 0, role: "R" }],
  },
  {
    id: "root-octave",
    name: "Root + Octave",
    description: "Classic bass shape: 2 strings up, 2 frets over.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 2, fretOffset: 2, role: "8" },
    ],
  },
  {
    id: "root-fifth",
    name: "Root + 5th",
    description: "Next string up, 2 frets over. Foundation of every bassline.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 1, fretOffset: 2, role: "5" },
    ],
  },
  {
    id: "r-5-8",
    name: "R – 5 – 8",
    description: "Root, fifth, octave. The skeleton of a bass groove.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 1, fretOffset: 2, role: "5" },
      { stringOffset: 2, fretOffset: 2, role: "8" },
    ],
  },
  {
    id: "major-triad",
    name: "Major triad",
    description: "R – 3 – 5. Happy sound.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 0, fretOffset: 4, role: "3" },
      { stringOffset: 1, fretOffset: 2, role: "5" },
    ],
  },
  {
    id: "minor-triad",
    name: "Minor triad",
    description: "R – ♭3 – 5. Darker, moodier.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 0, fretOffset: 3, role: "b3" },
      { stringOffset: 1, fretOffset: 2, role: "5" },
    ],
  },
  {
    id: "minor-pent-box1",
    name: "Minor pentatonic (box 1)",
    description: "R – ♭3 – 4 – 5 across two strings. The rock/blues box.",
    positions: [
      { stringOffset: 0, fretOffset: 0, role: "R" },
      { stringOffset: 0, fretOffset: 3, role: "b3" },
      { stringOffset: 1, fretOffset: 0, role: "4" },
      { stringOffset: 1, fretOffset: 2, role: "5" },
    ],
  },
];

/** Keys available in the picker. */
export const KEYS = NOTE_NAMES;

/**
 * Resolve a shape in a given key to absolute (string, fret) positions.
 * Root is placed on the E string.
 */
export function resolveShape(
  shape: Shape,
  rootPc: number,
  profile: InstrumentProfile,
): ResolvedPosition[] {
  const rootFret = findRootFret(profile, 0, rootPc);
  return shape.positions
    .filter((p) => p.stringOffset < profile.stringCount)
    .map((p) => {
      const fret = rootFret + p.fretOffset;
      return {
        string: p.stringOffset,
        fret,
        role: p.role,
        midi: midiAt(profile, p.stringOffset, fret),
      };
    });
}

interface ResolvedPosition {
  string: number;
  fret: number;
  role: Role;
  /** MIDI note this position sounds on the given profile. */
  midi: number;
}

export type MatchState = "green" | "yellow" | "red";
