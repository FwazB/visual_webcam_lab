// Fretboard positions for a profile: note names, root lookup, and
// all (string, fret) pairs that produce a given pitch.

import { midiAt, type InstrumentProfile } from "./profile";
import { NOTE_NAMES, pitchClassOf, type NoteName } from "./pitch";

export interface FretPosition {
  string: number;
  fret: number;
}

export function pitchClassAt(profile: InstrumentProfile, stringIdx: number, fret: number): number {
  return pitchClassOf(midiAt(profile, stringIdx, fret));
}

export function noteAt(profile: InstrumentProfile, stringIdx: number, fret: number): NoteName {
  return NOTE_NAMES[pitchClassAt(profile, stringIdx, fret)];
}

/** First fret (0..11) on a string whose pitch class matches `pc`. */
export function findRootFret(profile: InstrumentProfile, stringIdx: number, pc: number): number {
  const openPc = pitchClassOf(profile.tuning[stringIdx]);
  return ((pc - openPc) % 12 + 12) % 12;
}

/** Every (string, fret) on the instrument that sounds MIDI note `midi`. */
export function candidatePositions(profile: InstrumentProfile, midi: number): FretPosition[] {
  const out: FretPosition[] = [];
  for (let s = 0; s < profile.stringCount; s++) {
    const fret = midi - profile.tuning[s];
    if (fret >= 0 && fret <= profile.fretCount) out.push({ string: s, fret });
  }
  return out;
}
