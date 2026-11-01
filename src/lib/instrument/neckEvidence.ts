import type { PitchFrame } from "@/lib/audio/pitchTypes";
import type { FingerCandidate } from "./neckMapping";

export type NeckEvidenceStatus = "unseen" | "visible" | "agrees" | "differs" | "ambiguous" | "unsynced";

export interface NeckEvidenceInput {
  candidates: readonly FingerCandidate[];
  /** Frame ages must use the same monotonic clock. */
  handAgeMs: number;
  audioFrame: PitchFrame | null;
  audioAgeMs: number;
  audioRunning: boolean;
  gateDb: number;
  clarityThreshold: number;
}

export interface NeckEvidence {
  /** `agrees` means pitch-compatible; it never establishes string contact. */
  status: NeckEvidenceStatus;
  candidates: FingerCandidate[];
  heardMidi: number | null;
}

const MAX_FRAME_AGE_MS = 250;
const MAX_FRAME_SEPARATION_MS = 150;

function isFresh(ageMs: number): boolean {
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_FRAME_AGE_MS;
}

function acceptedMidi(input: NeckEvidenceInput): number | null {
  const frame = input.audioFrame;
  if (!input.audioRunning || !isFresh(input.audioAgeMs) || !frame) return null;
  if (![input.gateDb, input.clarityThreshold, frame.t, frame.hz, frame.midiFloat,
    frame.midi, frame.cents, frame.clarity, frame.rms, frame.db].every(Number.isFinite)) return null;
  if (!Number.isInteger(frame.midi) || frame.midi < 0 || frame.hz <= 0) return null;
  if (frame.clarity < input.clarityThreshold || frame.db < input.gateDb) return null;
  return frame.midi;
}

/** Compare observed position candidates with audio, independently of a lesson. */
export function evaluateNeckEvidence(input: NeckEvidenceInput): NeckEvidence {
  const candidates = isFresh(input.handAgeMs) ? [...input.candidates] : [];
  const heardMidi = acceptedMidi(input);
  const evidence = { candidates, heardMidi };
  if (candidates.length === 0) return { ...evidence, status: "unseen" };

  const distinctPositions = new Set(candidates.map(({ string, fret }) => `${string}:${fret}`));
  if (heardMidi === null) {
    return { ...evidence, status: distinctPositions.size > 1 ? "ambiguous" : "visible" };
  }
  if (Math.abs(input.handAgeMs - input.audioAgeMs) > MAX_FRAME_SEPARATION_MS) {
    return { ...evidence, status: "unsynced" };
  }
  if (distinctPositions.size > 1) return { ...evidence, status: "ambiguous" };
  return {
    ...evidence,
    status: candidates.every(({ midi }) => midi === heardMidi) ? "agrees" : "differs",
  };
}
