// 4-point projective transform (homography).
// Maps a unit square (0,0)(1,0)(1,1)(0,1) to any quadrilateral and back.

export interface Point {
  x: number;
  y: number;
}

// 3x3 matrix stored as a flat array in row-major order:
//   [a b c]
//   [d e f]
//   [g h i]
export type Matrix3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Build matrix mapping unit square (0,0)(1,0)(1,1)(0,1) → dest quad (p0,p1,p2,p3).
 * Uses the classic 4-point formula (see Heckbert 1989).
 */
function unitSquareToQuad(p0: Point, p1: Point, p2: Point, p3: Point): Matrix3 {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sy = p0.y - p1.y + p2.y - p3.y;

  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-10) {
    // Degenerate — return identity
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  return [a, b, c, d, e, f, g, h, 1];
}

/** Invert a 3x3 matrix. Returns null if non-invertible. */
function invert3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;

  return [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv];
}

/** Apply a 3x3 homography to a 2D point (homogeneous divide). */
export function applyMatrix(m: Matrix3, p: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = m;
  const w = g * p.x + h * p.y + i;
  if (Math.abs(w) < 1e-10) return { x: 0, y: 0 };
  return {
    x: (a * p.x + b * p.y + c) / w,
    y: (d * p.x + e * p.y + f) / w,
  };
}

export interface FretboardHomography {
  /** Fretboard coords (fret 0..12, string 0..3) → pixel coords in raw video space. */
  toPixel: Matrix3;
  /** Pixel coords → fretboard coords. */
  toFret: Matrix3;
}

/**
 * Build homographies from 4 pixel corner points.
 * Corners must be in order: nut×E, 12th×E, 12th×G, nut×G.
 * (E = string 0 = thickest, G = string 3 = thinnest.)
 */
export function buildFretboardHomography(
  nutE: Point,
  fret12E: Point,
  fret12G: Point,
  nutG: Point
): FretboardHomography | null {
  // Map unit square → pixel quad.
  // Unit square: (0,0) = nutE, (1,0) = 12thE, (1,1) = 12thG, (0,1) = nutG.
  // So unit u axis = fret / 12, unit v axis = string / 3.
  const unitToPixel = unitSquareToQuad(nutE, fret12E, fret12G, nutG);

  // Scale from fretboard coords (0..12, 0..3) to unit square (0..1, 0..1).
  // This is a simple diagonal matrix.
  const fretToUnit: Matrix3 = [
    1 / 12, 0,     0,
    0,      1 / 3, 0,
    0,      0,     1,
  ];

  // Compose: fret → unit → pixel
  const toPixel = multiply3(unitToPixel, fretToUnit);
  const toFret = invert3(toPixel);
  if (!toFret) return null;

  return { toPixel, toFret };
}

/** Multiply two 3x3 matrices (A * B). */
function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Convenience: project a fretboard (fret, string) position to pixel coords. */
export function fretToPixel(h: FretboardHomography, fret: number, string: number): Point {
  return applyMatrix(h.toPixel, { x: fret, y: string });
}

/** Convenience: project a pixel position to (fret, string). */
export function pixelToFret(h: FretboardHomography, px: Point): { fret: number; string: number } {
  const p = applyMatrix(h.toFret, px);
  return { fret: p.x, string: p.y };
}
