// Pitch math: MIDI <-> Hz <-> names.

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export type NoteName = (typeof NOTE_NAMES)[number];

export const A4_MIDI = 69;
export const A4_HZ = 440;

export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export interface PitchEstimate {
  midiFloat: number;
  midi: number;
  cents: number;
}

/** Convert a frequency to MIDI with cents deviation from the nearest semitone. */
export function hzToMidi(hz: number): PitchEstimate {
  if (!(hz > 0)) return { midiFloat: NaN, midi: -1, cents: 0 };
  const midiFloat = A4_MIDI + 12 * Math.log2(hz / A4_HZ);
  const midi = Math.round(midiFloat);
  return { midiFloat, midi, cents: (midiFloat - midi) * 100 };
}

export function pitchClassOf(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function midiToName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pitchClassOf(midi)]}${octave}`;
}
