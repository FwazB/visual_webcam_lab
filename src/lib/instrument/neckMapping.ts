import type { InstrumentProfile } from "./profile";

/** Coordinates are sensor-normalized image points unless explicitly called neck points. */
export interface NeckPoint {
  x: number;
  y: number;
}

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

/** Observed neck geometry, with no assumption about absolute fret identity. */
export interface NeckGeometry {
  /** First-side/near, second-side/near, first-side/far, second-side/far corners. */
  readonly points: readonly NeckPoint[];
  readonly imageToNeckMatrix: Matrix3;
  readonly neckToImageMatrix: Matrix3;
}

export interface NeckCalibration extends NeckGeometry {
  readonly firstFret: number;
  readonly lastFret: number;
  readonly profileId: string;
  readonly stringCount: number;
  readonly tuning: readonly number[];
  readonly fretCount: number;
}

export interface FingerCandidate {
  handIndex: number;
  /** Index, middle, ring, little finger. */
  finger: 1 | 2 | 3 | 4;
  string: number;
  fret: number;
  midi: number;
  /** Observed fingertip, not a snapped position or an inferred contact. */
  point: NeckPoint;
}

const EPSILON = 1e-9;
const FINGERTIPS = [8, 12, 16, 20] as const;
const UNIT_CORNERS: readonly NeckPoint[] = [
  { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
];

function inUnitSquare(point: NeckPoint, tolerance = 0): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= -tolerance && point.x <= 1 + tolerance
    && point.y >= -tolerance && point.y <= 1 + tolerance;
}

function validProfile(profile: InstrumentProfile): boolean {
  return Number.isInteger(profile.stringCount) && profile.stringCount >= 2
    && Number.isInteger(profile.fretCount) && profile.fretCount > 0
    && profile.tuning.length === profile.stringCount
    && profile.tuning.every((midi) => Number.isInteger(midi) && midi >= 0 && midi <= 127);
}

function matchesProfile(calibration: NeckCalibration, profile: InstrumentProfile): boolean {
  return validProfile(profile) && calibration.profileId === profile.id
    && calibration.stringCount === profile.stringCount && calibration.fretCount === profile.fretCount
    && calibration.tuning.every((midi, index) => midi === profile.tuning[index]);
}

function solveHomography(source: readonly NeckPoint[], destination: readonly NeckPoint[]): Matrix3 {
  const rows: number[][] = [];
  source.forEach(({ x, y }, index) => {
    const { x: u, y: v } = destination[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < EPSILON) throw new Error("Fretboard corners are too close or nearly collinear.");
    for (let index = column; index <= 8; index++) rows[column][index] /= divisor;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= 8; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return [rows[0][8], rows[1][8], rows[2][8], rows[3][8], rows[4][8], rows[5][8], rows[6][8], rows[7][8], 1];
}

function invert(matrix: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactors: [number, number, number, number, number, number, number, number, number] = [
    e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  ];
  const determinant = a * cofactors[0] + b * cofactors[3] + c * cofactors[6];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPSILON) {
    throw new Error("Fretboard corners are too close or nearly collinear.");
  }
  // Do not normalize the final element to one: a valid inverse may have h33=0.
  return cofactors.map((value) => value / determinant) as unknown as Matrix3;
}

function transform(matrix: Matrix3, point: NeckPoint): NeckPoint | null {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON) return null;
  const projected = {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
  if (!inUnitSquare(projected, EPSILON)) return null;
  // Only floating-point roundoff is clamped; off-neck observations are rejected.
  return { x: Math.max(0, Math.min(1, projected.x)), y: Math.max(0, Math.min(1, projected.y)) };
}

/** Rectify an observed quadrilateral without inventing fret numbers or spacing. */
export function createNeckGeometry(points: readonly NeckPoint[]): NeckGeometry {
  if (points.length !== 4 || points.some((point) => !inUnitSquare(point))) {
    throw new Error("Choose four fretboard intersections inside the camera image.");
  }
  const polygon = [points[0], points[2], points[3], points[1]];
  const turns = polygon.map((point, index) => {
    const next = polygon[(index + 1) % 4];
    const after = polygon[(index + 2) % 4];
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  if (!turns.every((turn) => turn > 1e-6) && !turns.every((turn) => turn < -1e-6)) {
    throw new Error("Corners must follow the labeled order around a visible, noncrossing fretboard.");
  }
  const copiedPoints = points.map(({ x, y }) => Object.freeze({ x, y }));
  const neckToImageMatrix = solveHomography(UNIT_CORNERS, copiedPoints);
  const imageToNeckMatrix = invert(neckToImageMatrix);
  if ([...imageToNeckMatrix, ...neckToImageMatrix].some((value) => !Number.isFinite(value))) {
    throw new Error("Fretboard calibration could not be resolved.");
  }
  return Object.freeze({
    points: Object.freeze(copiedPoints),
    imageToNeckMatrix: Object.freeze(imageToNeckMatrix),
    neckToImageMatrix: Object.freeze(neckToImageMatrix),
  });
}

/** Explicitly anchored mapping for callers that know the endpoint fret identities. */
export function createNeckCalibration(
  points: readonly NeckPoint[],
  firstFret: number,
  lastFret: number,
  profile: InstrumentProfile,
): NeckCalibration {
  if (!validProfile(profile)) throw new Error("Invalid instrument profile.");
  if (!Number.isInteger(firstFret) || !Number.isInteger(lastFret)
    || firstFret < 0 || lastFret <= firstFret || lastFret > profile.fretCount) {
    throw new Error(`Choose two fret wires from 0 to ${profile.fretCount}, in increasing order.`);
  }
  return Object.freeze({
    ...createNeckGeometry(points), firstFret, lastFret,
    profileId: profile.id, stringCount: profile.stringCount,
    tuning: Object.freeze([...profile.tuning]), fretCount: profile.fretCount,
  });
}

/** Neck x runs first to last wire; y runs lowest to highest string. */
export function imageToNeck(calibration: NeckGeometry, point: NeckPoint): NeckPoint | null {
  return inUnitSquare(point) ? transform(calibration.imageToNeckMatrix, point) : null;
}

export function neckToImage(calibration: NeckGeometry, point: NeckPoint): NeckPoint | null {
  return inUnitSquare(point) ? transform(calibration.neckToImageMatrix, point) : null;
}

/** Normalized longitudinal position of a fret wire. Out-of-range wires return NaN. */
export function fretCoordinate(calibration: NeckCalibration, fret: number): number {
  if (!Number.isInteger(fret) || fret < calibration.firstFret || fret > calibration.lastFret) return NaN;
  const first = 2 ** (-calibration.firstFret / 12);
  const last = 2 ** (-calibration.lastFret / 12);
  return (first - 2 ** (-fret / 12)) / (first - last);
}

/** Sensor point for a target just behind its fret wire. An open target sits at the nut. */
export function positionOnNeck(
  calibration: NeckCalibration, profile: InstrumentProfile, string: number, fret: number,
): NeckPoint | null {
  if (!matchesProfile(calibration, profile) || !Number.isInteger(string)
    || string < 0 || string >= profile.stringCount || !Number.isInteger(fret)) return null;
  if (fret === 0 && calibration.firstFret === 0) {
    return neckToImage(calibration, { x: 0, y: string / (profile.stringCount - 1) });
  }
  if (fret <= calibration.firstFret || fret > calibration.lastFret) return null;
  const start = fretCoordinate(calibration, fret - 1);
  const end = fretCoordinate(calibration, fret);
  return neckToImage(calibration, { x: start + (end - start) * 0.75, y: string / (profile.stringCount - 1) });
}

/**
 * Geometric candidates only: projected overlap cannot prove string contact.
 * No lesson target, audio, handedness score or absent finger chooses a position.
 */
export function locateFingers(
  calibration: NeckCalibration,
  profile: InstrumentProfile,
  hands: readonly { landmarks: readonly { x: number; y: number; z?: number }[] }[],
): FingerCandidate[] {
  if (!matchesProfile(calibration, profile)) return [];
  const candidates: FingerCandidate[] = [];
  hands.forEach((hand, handIndex) => {
    FINGERTIPS.forEach((landmarkIndex, fingerIndex) => {
      const tip = hand.landmarks[landmarkIndex];
      if (!tip || (tip.z !== undefined && !Number.isFinite(tip.z))) return;
      const neck = imageToNeck(calibration, tip);
      if (!neck) return;
      const first = 2 ** (-calibration.firstFret / 12);
      const last = 2 ** (-calibration.lastFret / 12);
      const fractionalFret = -12 * Math.log2(first - neck.x * (first - last));
      const nearestWire = Math.round(fractionalFret);
      const frets = Math.abs(fractionalFret - nearestWire) <= 0.08
        ? [nearestWire, nearestWire + 1] : [Math.ceil(fractionalFret)];
      const stringCoordinate = neck.y * (profile.stringCount - 1);
      for (let string = 0; string < profile.stringCount; string++) {
        // Keep both strings close to their midpoint instead of silently snapping.
        if (Math.abs(stringCoordinate - string) > 0.6 + EPSILON) continue;
        for (const fret of frets) {
          if (fret <= calibration.firstFret || fret > calibration.lastFret) continue;
          candidates.push({
            handIndex, finger: (fingerIndex + 1) as FingerCandidate["finger"], string, fret,
            midi: profile.tuning[string] + fret, point: { x: tip.x, y: tip.y },
          });
        }
      }
    });
  });
  return candidates;
}
