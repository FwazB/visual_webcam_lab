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

const EPSILON = 1e-9;
const UNIT_CORNERS: readonly NeckPoint[] = [
  { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
];

function inUnitSquare(point: NeckPoint, tolerance = 0): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= -tolerance && point.x <= 1 + tolerance
    && point.y >= -tolerance && point.y <= 1 + tolerance;
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

/** Neck x runs first to last observed fret; y runs between the observed outer rails. */
export function imageToNeck(calibration: NeckGeometry, point: NeckPoint): NeckPoint | null {
  return inUnitSquare(point) ? transform(calibration.imageToNeckMatrix, point) : null;
}

export function neckToImage(calibration: NeckGeometry, point: NeckPoint): NeckPoint | null {
  return inUnitSquare(point) ? transform(calibration.neckToImageMatrix, point) : null;
}
