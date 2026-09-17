// Types shared between the pitch worklet, the note tracker, and consumers.

export interface PitchFrame {
  /** AudioContext seconds at the end of the analysed hop. */
  t: number;
  /** Fundamental in Hz, 0 when unvoiced. */
  hz: number;
  /** NaN when unvoiced. */
  midiFloat: number;
  /** Rounded MIDI, −1 when unvoiced. */
  midi: number;
  /** −50..50 cents from the rounded MIDI. */
  cents: number;
  /** NSDF peak value, 0..1. */
  clarity: number;
  rms: number;
  db: number;
}

export interface NoteEvent {
  id: number;
  /** AudioContext seconds of the physical onset (not receipt time). */
  t: number;
  /** performance.now()-domain estimate of the same instant. */
  tPerf: number;
  midi: number;
  midiFloat: number;
  cents: number;
  hz: number;
  /** 0..1: clarity of the median frame × pitch stability. */
  confidence: number;
  /** 0..1 from the onset's dB rise; legato notes get 0.3. */
  strength: number;
  kind: "pluck" | "legato";
}

export interface NoteOff {
  id: number;
  t: number;
}

export type WorkletMessage =
  | { type: "frame"; t: number; hz: number; clarity: number; rms: number; db: number }
  | { type: "onset"; t: number; strength: number; rms: number };

export interface WorkletConfig {
  fMin: number;
  fMax: number;
  windowMs: number;
  hopMs: number;
  clarityThreshold: number;
  gateDb: number;
  k: number;
  onsetRiseDb: number;
  refractoryMs: number;
}
