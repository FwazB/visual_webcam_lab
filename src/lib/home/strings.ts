// Plucked-string motion for the homepage hero: an ideal string released
// from a triangle shape, as a damped sum of its first harmonics.

export interface Pluck {
  /** Pluck position along the string, 0..1. */
  at: number;
  /** Peak displacement in px at the pluck point. */
  amplitude: number;
  /** Start time in seconds. */
  t0: number;
}

const HARMONICS = 8;
/** Visual vibration rate of the fundamental (Hz), slowed from audio pitch so the eye can follow it. */
const VISUAL_HZ = 7;
/** Envelope time constant of the fundamental (s); higher harmonics die faster. */
const DECAY_S = 0.9;

/** Displacement at position x (0..1) and time t (s) for one pluck. */
export function displacement(p: Pluck, x: number, t: number): number {
  const dt = t - p.t0;
  if (dt < 0) return 0;
  const a = Math.min(0.98, Math.max(0.02, p.at));
  let y = 0;
  for (let n = 1; n <= HARMONICS; n++) {
    // Fourier coefficient of a triangle with its peak at `a`, normalised so the
    // sum is 1 at the pluck point when dt = 0.
    const coeff = (2 / (n * n * Math.PI * Math.PI * a * (1 - a))) * Math.sin(n * Math.PI * a);
    const envelope = Math.exp((-dt * n) / DECAY_S);
    y += coeff * Math.sin(n * Math.PI * x) * Math.cos(2 * Math.PI * VISUAL_HZ * n * dt) * envelope;
  }
  return p.amplitude * y;
}

/** Remaining energy of a pluck, 0..1: 1 when released (or not yet), ~0 when still. */
export function energy(p: Pluck, t: number): number {
  return Math.exp(-Math.max(0, t - p.t0) / DECAY_S);
}

/** A pluck is visibly over once its envelope falls below this. */
export const SETTLED = 0.01;

/** Indices of the strings whose y lies between two pointer positions. */
export function crossedStrings(prevY: number, y: number, stringYs: number[]): number[] {
  const lo = Math.min(prevY, y);
  const hi = Math.max(prevY, y);
  const hit = stringYs.flatMap((sy, i) => (sy > lo && sy <= hi) || (sy >= lo && sy < hi) ? [i] : []);
  return y >= prevY ? hit : hit.reverse();
}

/** Pluck amplitude (px) from pointer speed (px/ms), capped to the string gap. */
export function amplitudeFor(speed: number, gap: number): number {
  return Math.min(gap * 0.42, 4 + speed * 9);
}
