import type { PitchFrame } from "@/lib/audio/pitchTypes";

interface HeardNoteInput {
  audioFrame: PitchFrame | null;
  audioAgeMs: number;
  audioRunning: boolean;
  gateDb: number;
  clarityThreshold: number;
}

const MAX_FRAME_AGE_MS = 250;

function isFresh(ageMs: number): boolean {
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_FRAME_AGE_MS;
}

/** A fresh, voiced audio note; independent of camera landmarks and lesson targets. */
export function readHeardMidi(input: HeardNoteInput): number | null {
  const frame = input.audioFrame;
  if (!input.audioRunning || !isFresh(input.audioAgeMs) || !frame) return null;
  if (![input.gateDb, input.clarityThreshold, frame.t, frame.hz, frame.midiFloat,
    frame.midi, frame.cents, frame.clarity, frame.rms, frame.db].every(Number.isFinite)) return null;
  if (!Number.isInteger(frame.midi) || frame.midi < 0 || frame.hz <= 0) return null;
  if (frame.clarity < input.clarityThreshold || frame.db < input.gateDb) return null;
  return frame.midi;
}
