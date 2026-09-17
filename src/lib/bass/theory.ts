// Bass music theory adapter.
// @deprecated Prefer `@/lib/instrument` with an explicit InstrumentProfile.
// These wrappers are bound to BASS_STANDARD so existing callers keep working.

import { BASS_STANDARD } from "@/lib/instrument/profile";
import {
  findRootFret as findRootFretFor,
  noteAt as noteAtFor,
  pitchClassAt,
} from "@/lib/instrument/positions";

export { NOTE_NAMES, type NoteName } from "@/lib/instrument/pitch";

/** Pitch class (0..11) for a given (string, fret) on a standard bass. */
export function pitchClass(stringIdx: number, fret: number): number {
  return pitchClassAt(BASS_STANDARD, stringIdx, fret);
}

/** Note name for (string, fret) on a standard bass. */
export function noteAt(stringIdx: number, fret: number) {
  return noteAtFor(BASS_STANDARD, stringIdx, fret);
}

/** First fret (0..11) on a given bass string where the pitch class matches. */
export function findRootFret(stringIdx: number, pc: number): number {
  return findRootFretFor(BASS_STANDARD, stringIdx, pc);
}
