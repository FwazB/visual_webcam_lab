const CENTER = 3;
const FULL = 25;

export function headTiltAmount(degrees: number | null): number {
  if (degrees === null || !Number.isFinite(degrees) || Math.abs(degrees) <= CENTER) return 0;
  return Math.sign(degrees) * Math.min(1, (Math.abs(degrees) - CENTER) / (FULL - CENTER));
}

/** One action per excursion. Visiting a page mid-tilt must not trigger it. */
export function readTiltStep(armed: boolean, degrees: number | null): { armed: boolean; step: -1 | 0 | 1 } {
  if (degrees === null || !Number.isFinite(degrees)) return { armed: false, step: 0 };
  if (Math.abs(degrees) <= CENTER) return { armed: true, step: 0 };
  if (armed && Math.abs(degrees) >= 15) return { armed: false, step: degrees > 0 ? 1 : -1 };
  return { armed, step: 0 };
}
