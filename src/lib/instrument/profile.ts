// Instrument profiles: data-driven description of a fretted instrument.
// Everything downstream (neck detection, pitch detection, lesson theory)
// reads from a profile instead of hard-coding guitar vs bass.

export interface PitchDetectionSettings {
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
  /** Scale length (nut to bridge saddle) in mm. */
  scaleLengthMm: number;
  nutWidthMm: number;
  widthAt12Mm: number;
  /** Fraction of the neck width from the edge to the outer string. */
  stringInsetFraction: number;
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
  scaleLengthMm: 648,
  nutWidthMm: 43,
  widthAt12Mm: 52,
  stringInsetFraction: 0.085,
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
  scaleLengthMm: 864,
  nutWidthMm: 40,
  widthAt12Mm: 56,
  stringInsetFraction: 0.085,
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

export const PROFILES: Record<string, InstrumentProfile> = {
  [GUITAR_STANDARD.id]: GUITAR_STANDARD,
  [BASS_STANDARD.id]: BASS_STANDARD,
};

/** Ratio between consecutive fret gaps: 2^(-1/12). */
export const RHO = Math.pow(2, -1 / 12);

/** Fraction of the scale length from the nut to fret wire n. f(0) = 0. */
export function fretFraction(n: number): number {
  return 1 - Math.pow(RHO, n);
}

/** Inverse of fretFraction: fractional fret index for a scale fraction f. */
export function fractionToFret(f: number): number {
  return -12 * Math.log2(1 - f);
}

/** Distance in mm from the nut to fret wire n. */
export function fretDistanceMm(profile: InstrumentProfile, n: number): number {
  return profile.scaleLengthMm * fretFraction(n);
}

/** Neck width in mm at fret wire n, linear between nut and 12th fret. */
export function neckWidthMmAt(profile: InstrumentProfile, n: number): number {
  const d = fretFraction(n) / fretFraction(12);
  return profile.nutWidthMm + (profile.widthAt12Mm - profile.nutWidthMm) * d;
}

/** MIDI note number produced by (string, fret). */
export function midiAt(profile: InstrumentProfile, stringIdx: number, fret: number): number {
  return profile.tuning[stringIdx] + fret;
}
