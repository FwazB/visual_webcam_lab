// Pixel-level helpers: gray sampling, rotated strip sampling, 1D filters,
// gradient orientation histogram. Pure functions over typed arrays.

import type { Point, RgbaFrame } from "./types";

export function grayAt(frame: RgbaFrame, x: number, y: number): number {
  const i = (y * frame.width + x) * 4;
  const d = frame.data;
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Bilinear gray sample; returns NaN outside the frame. */
export function sampleGray(frame: RgbaFrame, x: number, y: number): number {
  if (x < 0 || y < 0 || x > frame.width - 1 || y > frame.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, frame.width - 1);
  const y1 = Math.min(y0 + 1, frame.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const g00 = grayAt(frame, x0, y0);
  const g10 = grayAt(frame, x1, y0);
  const g01 = grayAt(frame, x0, y1);
  const g11 = grayAt(frame, x1, y1);
  const top = g00 + (g10 - g00) * fx;
  const bot = g01 + (g11 - g01) * fx;
  return top + (bot - top) * fy;
}

export interface Strip {
  /** Row-major gray values, nS rows × nT columns. NaN where off-frame. */
  g: Float32Array;
  nT: number;
  nS: number;
  origin: Point;
  dir: Point;
  normal: Point;
  /** Along coordinate of column 0. */
  t0: number;
  /** Across coordinate of row 0. */
  s0: number;
}

/**
 * Sample a rotated strip: column i ↔ t = t0 + i, row j ↔ s = s0 + j·rowStep.
 */
export function sampleStrip(
  frame: RgbaFrame,
  origin: Point,
  dir: Point,
  normal: Point,
  t0: number,
  nT: number,
  s0: number,
  nS: number,
  rowStep = 1,
): Strip {
  const g = new Float32Array(nT * nS);
  const { data, width, height } = frame;
  const maxX = width - 1;
  const maxY = height - 1;
  for (let j = 0; j < nS; j++) {
    const s = s0 + j * rowStep;
    let px = origin.x + normal.x * s + dir.x * t0;
    let py = origin.y + normal.y * s + dir.y * t0;
    const row = j * nT;
    for (let i = 0; i < nT; i++, px += dir.x, py += dir.y) {
      if (px < 0 || py < 0 || px > maxX || py > maxY) {
        g[row + i] = NaN;
        continue;
      }
      const x0 = px | 0;
      const y0 = py | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = px - x0;
      const fy = py - y0;
      const i00 = (y0 * width + x0) << 2;
      const i10 = (y0 * width + x1) << 2;
      const i01 = (y1 * width + x0) << 2;
      const i11 = (y1 * width + x1) << 2;
      const g00 = 0.299 * data[i00] + 0.587 * data[i00 + 1] + 0.114 * data[i00 + 2];
      const g10 = 0.299 * data[i10] + 0.587 * data[i10 + 1] + 0.114 * data[i10 + 2];
      const g01 = 0.299 * data[i01] + 0.587 * data[i01 + 1] + 0.114 * data[i01 + 2];
      const g11 = 0.299 * data[i11] + 0.587 * data[i11 + 1] + 0.114 * data[i11 + 2];
      const top = g00 + (g10 - g00) * fx;
      const bot = g01 + (g11 - g01) * fx;
      g[row + i] = top + (bot - top) * fy;
    }
  }
  return { g, nT, nS, origin, dir, normal, t0, s0 };
}

/** Along-axis range [tMin, tMax] where the line origin + dir·t stays inside the frame (with margin). */
export function axisRangeInFrame(
  frame: { width: number; height: number },
  origin: Point,
  dir: Point,
  margin: number,
): [number, number] | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const clip = (o: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) {
        tMin = Infinity;
        tMax = -Infinity;
      }
      return;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
  };
  clip(origin.x, dir.x, margin, frame.width - 1 - margin);
  clip(origin.y, dir.y, margin, frame.height - 1 - margin);
  if (!(tMax > tMin)) return null;
  return [tMin, tMax];
}

export function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Difference-of-Gaussians kernel (σ1 < σ2): a band-pass line detector. */
export function dogKernel(sigma1: number, sigma2: number): Float32Array {
  const k1 = gaussianKernel(sigma1);
  const k2 = gaussianKernel(sigma2);
  const r = (k2.length - 1) / 2;
  const r1 = (k1.length - 1) / 2;
  const k = new Float32Array(k2.length);
  for (let i = -r; i <= r; i++) {
    const a = Math.abs(i) <= r1 ? k1[i + r1] : 0;
    k[i + r] = a - k2[i + r];
  }
  return k;
}

/**
 * Convolve each row of a strip with a kernel and take |·|. NaN inputs are
 * treated as the row mean (so off-frame regions do not ring).
 */
export function absConvolveRows(src: Float32Array, nT: number, nS: number, kernel: Float32Array): Float32Array {
  const out = new Float32Array(nT * nS);
  const r = (kernel.length - 1) / 2;
  const kl = kernel.length;
  const padded = new Float32Array(nT + 2 * r);
  for (let j = 0; j < nS; j++) {
    const base = j * nT;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < nT; i++) {
      const v = src[base + i];
      if (v === v) {
        sum += v;
        cnt++;
      }
    }
    const mean = cnt > 0 ? sum / cnt : 0;
    for (let i = 0; i < nT; i++) {
      const v = src[base + i];
      padded[i + r] = v === v ? v : mean;
    }
    for (let i = 0; i < r; i++) {
      padded[i] = padded[r];
      padded[nT + r + i] = padded[nT + r - 1];
    }
    for (let i = 0; i < nT; i++) {
      let acc = 0;
      for (let k = 0; k < kl; k++) acc += padded[i + k] * kernel[k];
      out[base + i] = acc < 0 ? -acc : acc;
    }
  }
  return out;
}

/**
 * Dominant edge orientation (radians, mod π) inside a box, from a Sobel
 * gradient-orientation histogram. Returns the histogram peak angle nearest
 * `preferAngle` within ±`window`, or null if the box is too small/flat.
 *
 * The returned angle is the direction ALONG which the lines run (perpendicular
 * to the gradient), i.e. the fret wires' direction.
 */
export function dominantLineAngle(
  frame: RgbaFrame,
  centre: Point,
  halfSize: number,
  preferAngle: number,
  window: number,
  stride = 2,
  bins = 36,
): { angle: number; mass: number } | null {
  const x0 = Math.max(1, Math.floor(centre.x - halfSize));
  const x1 = Math.min(frame.width - 2, Math.ceil(centre.x + halfSize));
  const y0 = Math.max(1, Math.floor(centre.y - halfSize));
  const y1 = Math.min(frame.height - 2, Math.ceil(centre.y + halfSize));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const hist = new Float32Array(bins);
  for (let y = y0; y <= y1; y += stride) {
    for (let x = x0; x <= x1; x += stride) {
      const gx =
        grayAt(frame, x + 1, y - 1) + 2 * grayAt(frame, x + 1, y) + grayAt(frame, x + 1, y + 1) -
        grayAt(frame, x - 1, y - 1) - 2 * grayAt(frame, x - 1, y) - grayAt(frame, x - 1, y + 1);
      const gy =
        grayAt(frame, x - 1, y + 1) + 2 * grayAt(frame, x, y + 1) + grayAt(frame, x + 1, y + 1) -
        grayAt(frame, x - 1, y - 1) - 2 * grayAt(frame, x, y - 1) - grayAt(frame, x + 1, y - 1);
      const mag = Math.hypot(gx, gy);
      if (mag < 24) continue;
      // Line direction is perpendicular to the gradient.
      let ang = Math.atan2(gy, gx) + Math.PI / 2;
      ang = ((ang % Math.PI) + Math.PI) % Math.PI;
      const b = Math.min(bins - 1, Math.floor((ang / Math.PI) * bins));
      hist[b] += mag;
    }
  }
  let best = -1;
  let bestVal = 0;
  const pref = ((preferAngle % Math.PI) + Math.PI) % Math.PI;
  for (let b = 0; b < bins; b++) {
    const ang = ((b + 0.5) / bins) * Math.PI;
    let d = Math.abs(ang - pref);
    if (d > Math.PI / 2) d = Math.PI - d;
    if (d > window) continue;
    if (hist[b] > bestVal) {
      bestVal = hist[b];
      best = b;
    }
  }
  if (best < 0 || bestVal === 0) return null;
  // Parabolic refine across neighbouring bins (circular).
  const l = hist[(best - 1 + bins) % bins];
  const c = hist[best];
  const r = hist[(best + 1) % bins];
  const denom = l - 2 * c + r;
  const delta = Math.abs(denom) > 1e-6 ? (0.5 * (l - r)) / denom : 0;
  return { angle: (((best + 0.5 + delta) / bins) * Math.PI) % Math.PI, mass: bestVal };
}
