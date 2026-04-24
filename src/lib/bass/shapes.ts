// Shape library: transposable fretboard patterns.
// Positions are relative to the root; the root sits on the E string.

import { findRootFret, type NoteName } from "./theory";

export type Role =
  | "R" | "b3" | "3" | "4" | "5" | "b7" | "7" | "8";

export interface ShapePosition {
  /** 0 = E, 1 = A, 2 = D, 3 = G */
  stringOffset: number;
  /** Semitones from the root fret, interpreted as frets on the target string. */
  fretOffset: number;
  role: Role;
}

export interface Shape {
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
export const KEYS: NoteName[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/**
 * Resolve a shape in a given key to absolute (string, fret) positions.
 * Root is placed on the E string.
 */
export function resolveShape(
  shape: Shape,
  rootPc: number
): Array<{ string: number; fret: number; role: Role }> {
  const rootFret = findRootFret(0, rootPc);
  return shape.positions.map((p) => ({
    string: p.stringOffset,
    fret: rootFret + p.fretOffset,
    role: p.role,
  }));
}

export type MatchState = "green" | "yellow" | "red";

/**
 * Compare current fingertip positions vs. resolved shape targets.
 * Returns the traffic-light state and how many targets were covered.
 */
export function matchShape(
  targets: Array<{ string: number; fret: number }>,
  fingers: Array<{ string: number; fret: number }>
): { state: MatchState; coveredIdx: Set<number> } {
  const STRING_TOL = 0.4;
  const FRET_TOL = 0.6;
  const covered = new Set<number>();

  targets.forEach((tgt, i) => {
    const hit = fingers.some(
      (fp) =>
        Math.abs(fp.string - tgt.string) <= STRING_TOL &&
        Math.abs(fp.fret - tgt.fret) <= FRET_TOL
    );
    if (hit) covered.add(i);
  });

  if (covered.size === targets.length) return { state: "green", coveredIdx: covered };
  if (covered.size >= Math.max(1, Math.ceil(targets.length / 2))) {
    return { state: "yellow", coveredIdx: covered };
  }

  // Even one finger near a target → yellow
  const near = fingers.some((fp) =>
    targets.some(
      (tgt) =>
        Math.abs(fp.string - tgt.string) <= 1.0 &&
        Math.abs(fp.fret - tgt.fret) <= 1.5
    )
  );
  return { state: near ? "yellow" : "red", coveredIdx: covered };
}
