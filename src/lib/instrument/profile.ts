// Instrument profiles: data-driven description of a fretted instrument.
// Pitch detection, lessons and the fretboard diagram read from a profile
// instead of hard-coding guitar vs bass.

interface PitchDetectionSettings {
  /** Lowest fundamental to search for (Hz). */
  fMin: number;
  /** Highest fundamental to search for (Hz). */
  fMax: number;
  /** Analysis window length (ms). ~2 periods of fMin must fit in half a window. */
  windowMs: number;
  /** Hop between analyses (ms). */
  hopMs: number;
  /** Pre-filter low-pass cutoff (Hz) to tame amp harmonics. */
  lpfHz: number;
  /** NSDF clarity threshold below which a frame is "unvoiced". */
  clarityThreshold: number;
}

export interface InstrumentProfile {
  id: string;
  name: string;
  stringCount: number;
  /** Open-string MIDI numbers, low-pitched string first (index 0 = lowest). */
  tuning: number[];
  fretCount: number;
  /** Frets that carry face inlay dots; 12 is the double dot. */
  inlayFrets: number[];
  /** Display labels per string, same order as `tuning`. */
  stringLabels: string[];
  pitch: PitchDetectionSettings;
}

export const GUITAR_STANDARD: InstrumentProfile = {
  id: "guitar-standard",
  name: "Guitar",
  stringCount: 6,
  tuning: [40, 45, 50, 55, 59, 64], // E2 A2 D3 G3 B3 E4
  fretCount: 22,
  inlayFrets: [3, 5, 7, 9, 12, 15, 17, 19, 21],
  stringLabels: ["E", "A", "D", "G", "B", "e"],
  pitch: {
    fMin: 60,
    fMax: 1500,
    windowMs: 46,
    hopMs: 11.6,
    lpfHz: 1500,
    clarityThreshold: 0.85,
  },
};

export const BASS_STANDARD: InstrumentProfile = {
  id: "bass-standard",
  name: "Bass",
  stringCount: 4,
  tuning: [28, 33, 38, 43], // E1 A1 D2 G2
  fretCount: 20,
  inlayFrets: [3, 5, 7, 9, 12, 15, 17, 19],
  stringLabels: ["E", "A", "D", "G"],
  pitch: {
    fMin: 30,
    fMax: 800,
    windowMs: 93,
    hopMs: 11.6,
    lpfHz: 800,
    clarityThreshold: 0.85,
  },
};

/** MIDI note number produced by (string, fret). */
export function midiAt(profile: InstrumentProfile, stringIdx: number, fret: number): number {
  return profile.tuning[stringIdx] + fret;
}
