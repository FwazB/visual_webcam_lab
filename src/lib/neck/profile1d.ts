// Along-axis wire profile, peak picking, and neck band (edge) estimation.

import type { Strip } from "./image";
import { absConvolveRows, dogKernel } from "./image";
import type { EdgeLine, WireDetection } from "./types";

const DOG = dogKernel(1.0, 4);
const DOG_WIDE = dogKernel(2.5, 9);

export interface BandResponse {
  /** |DoG| response per strip cell, nS × nT. */
  r: Float32Array;
  nT: number;
  nS: number;
}

export function bandpassStrip(strip: Strip): BandResponse {
  return { r: absConvolveRows(strip.g, strip.nT, strip.nS, DOG), nT: strip.nT, nS: strip.nS };
}

/** Column validity: false inside masked t-intervals and in the outer border. */
export function columnMask(
  strip: Strip,
  masks: Array<[number, number]>,
  borderFraction = 0.03,
): Uint8Array {
  const valid = new Uint8Array(strip.nT);
  const border = Math.ceil(strip.nT * borderFraction);
  for (let i = 0; i < strip.nT; i++) {
    const t = strip.t0 + i;
    let ok = i >= border && i < strip.nT - border;
    // Off-frame columns (NaN in the middle row) are invalid.
    const mid = strip.g[Math.floor(strip.nS / 2) * strip.nT + i];
    if (Number.isNaN(mid)) ok = false;
    for (const [a, b] of masks) if (t >= a && t <= b) ok = false;
    valid[i] = ok ? 1 : 0;
  }
  return valid;
}

/**
 * p-th percentile of values[0..n) by quickselect (O(n) average). Mutates the
 * prefix of `values`.
 */
export function percentile(values: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  const k = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))));
  let lo = 0;
  let hi = n - 1;
  while (hi > lo) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}

/**
 * Along-axis profile: the 30th percentile across the selected rows. A real
 * wire spans every row; inlays, glints and shadows do not survive a low
 * percentile.
 */
export function alongProfile(resp: BandResponse, rowFrom: number, rowTo: number, p = 0.3): Float32Array {
  const { r, nT } = resp;
  const nRows = Math.max(1, rowTo - rowFrom);
  const col = new Float32Array(nRows);
  const out = new Float32Array(nT);
  for (let i = 0; i < nT; i++) {
    let n = 0;
    for (let j = rowFrom; j < rowTo; j++) {
      const v = r[j * nT + i];
      if (!Number.isNaN(v)) col[n++] = v;
    }
    out[i] = percentile(col, n, p);
  }
  return out;
}

function medianAndMad(values: number[]): { median: number; mad: number } {
  if (values.length === 0) return { median: 0, mad: 0 };
  const s = values.slice().sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  const dev = s.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return { median, mad: dev[Math.floor(dev.length / 2)] };
}

/**
 * Peak picking: non-maximum suppression, prominence threshold from robust
 * statistics of the valid columns, parabolic sub-pixel refinement, and
 * width-at-half-max as a thickness estimate.
 */
export function pickWires(
  profile: Float32Array,
  valid: Uint8Array,
  t0: number,
  opts: { nmsRadius?: number; sigmaMultiplier?: number; normalize?: boolean } = {},
): WireDetection[] {
  const nmsRadius = opts.nmsRadius ?? 6;
  const normalize = opts.normalize ?? true;
  const k = opts.sigmaMultiplier ?? 2;
  const nT = profile.length;
  const validVals: number[] = [];
  for (let i = 0; i < nT; i++) if (valid[i]) validVals.push(profile[i]);
  const { median, mad } = medianAndMad(validVals);
  const threshold = median + k * Math.max(mad, 1e-3) * 1.4826;

  const wires: WireDetection[] = [];
  for (let i = 1; i < nT - 1; i++) {
    if (!valid[i]) continue;
    const v = profile[i];
    if (v <= threshold) continue;
    let isMax = true;
    for (let d = -nmsRadius; d <= nmsRadius && isMax; d++) {
      if (d === 0) continue;
      const idx = i + d;
      if (idx < 0 || idx >= nT) continue;
      if (profile[idx] > v || (profile[idx] === v && d < 0)) isMax = false;
    }
    if (!isMax) continue;

    const a = profile[i - 1];
    const b = v;
    const c = profile[i + 1];
    const denom = a - 2 * b + c;
    const delta = Math.abs(denom) > 1e-9 ? (0.5 * (a - c)) / denom : 0;
    const peakVal = b - 0.25 * (a - c) * delta;

    // Width at half max (above the baseline median).
    const half = median + (peakVal - median) / 2;
    let l = i;
    while (l > 0 && i - l < 12 && profile[l - 1] > half) l--;
    let r = i;
    while (r < nT - 1 && r - i < 12 && profile[r + 1] > half) r++;

    wires.push({
      t: t0 + i + delta,
      strength: peakVal - median,
      thicknessPx: r - l + 1,
    });
  }
  const maxStrength = wires.reduce((m, w) => Math.max(m, w.strength), 0);
  if (normalize && maxStrength > 0) for (const w of wires) w.strength /= maxStrength;
  return wires;
}

/**
 * Row energy: mean response over a set of columns. With `columns` = fitted
 * wire columns the energy is specific to the neck; with all valid columns it
 * is a coarse first pass.
 */
export function rowEnergy(resp: BandResponse, columns: number[]): Float32Array {
  const { r, nT, nS } = resp;
  const e = new Float32Array(nS);
  for (let j = 0; j < nS; j++) {
    let sum = 0;
    let n = 0;
    for (const i of columns) {
      const v = r[j * nT + i];
      if (!Number.isNaN(v)) {
        sum += v;
        n++;
      }
    }
    e[j] = n > 0 ? sum / n : 0;
  }
  return e;
}

/**
 * Row peakiness: a high percentile of the response over the given columns.
 * Rows crossing the fingerboard contain periodic wire spikes, so their high
 * percentile is far above the noise floor even though wires are sparse.
 */
export function rowPeakiness(resp: BandResponse, columns: number[], p = 0.985): Float32Array {
  const { r, nT, nS } = resp;
  const e = new Float32Array(nS);
  const buf = new Float32Array(columns.length);
  for (let j = 0; j < nS; j++) {
    let n = 0;
    for (const i of columns) {
      const v = r[j * nT + i];
      if (!Number.isNaN(v)) buf[n++] = v;
    }
    e[j] = percentile(buf, n, p);
  }
  return e;
}

/**
 * Row band whose energy exceeds `fraction` × max. With `anchorRow` given,
 * returns the run containing (or nearest to) that row; otherwise the longest
 * run. Energy is smoothed over 3 rows first. Returns [jTop, jBot] inclusive.
 */
export function bandFromEnergy(e: Float32Array, fraction = 0.4, anchorRow: number | null = null): [number, number] | null {
  const n = e.length;
  const sm = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const a = e[Math.max(0, j - 1)];
    const b = e[j];
    const c = e[Math.min(n - 1, j + 1)];
    sm[j] = (a + b + c) / 3;
  }
  let max = 0;
  for (let j = 0; j < n; j++) max = Math.max(max, sm[j]);
  if (max <= 0) return null;
  const thr = fraction * max;
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let j = 0; j <= n; j++) {
    const on = j < n && sm[j] > thr;
    if (on && start < 0) start = j;
    if (!on && start >= 0) {
      runs.push([start, j - 1]);
      start = -1;
    }
  }
  if (runs.length === 0) return null;
  if (anchorRow === null) {
    return runs.reduce((best, r) => (r[1] - r[0] > best[1] - best[0] ? r : best));
  }
  let best = runs[0];
  let bestDist = Infinity;
  for (const r of runs) {
    const dist = anchorRow < r[0] ? r[0] - anchorRow : anchorRow > r[1] ? anchorRow - r[1] : 0;
    // Prefer the run around the anchor; break near-ties by length.
    const score = dist - 0.1 * (r[1] - r[0]);
    if (score < bestDist) {
      bestDist = score;
      best = r;
    }
  }
  return best;
}

/**
 * Estimate the two neck edges as lines s(t) = s0 + slope·t by finding the
 * band in several along-axis segments and least-squares fitting.
 * `segmentColumns[i]` are the strip columns to use for segment i.
 */
export function fitEdges(
  resp: BandResponse,
  strip: Strip,
  segmentColumns: number[][],
  rowStep: number,
  statistic: "mean" | "peak" = "mean",
): { top: EdgeLine; bottom: EdgeLine; halfWidth: number } | null {
  const tops: Array<[number, number]> = [];
  const bots: Array<[number, number]> = [];
  for (const cols of segmentColumns) {
    if (cols.length < 2) continue;
    const e = statistic === "peak" ? rowPeakiness(resp, cols) : rowEnergy(resp, cols);
    const band = bandFromEnergy(e);
    if (!band || band[1] - band[0] < 4) continue;
    let tSum = 0;
    for (const i of cols) tSum += strip.t0 + i;
    const tc = tSum / cols.length;
    tops.push([tc, strip.s0 + band[0] * rowStep]);
    bots.push([tc, strip.s0 + band[1] * rowStep]);
  }
  if (tops.length === 0) return null;
  const top = lineFit(tops);
  const bottom = lineFit(bots);
  const halfWidth = (bottom.s0 - top.s0) / 2;
  if (!(halfWidth > 2)) return null;
  return { top, bottom, halfWidth };
}

function lineFit(pts: Array<[number, number]>): EdgeLine {
  if (pts.length === 1) return { s0: pts[0][1], slope: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = pts.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { s0: sy / n, slope: 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const s0 = (sy - slope * sx) / n;
  return { s0, slope };
}

/**
 * Wide-bar detector for the nut (and similar thick bright/dark bars) over a
 * row range. Returns peaks not already explained by a thin wire.
 */
export function pickWideBars(
  strip: Strip,
  rowFrom: number,
  rowTo: number,
  valid: Uint8Array,
  thinWires: WireDetection[],
): WireDetection[] {
  const nRows = Math.max(1, rowTo - rowFrom);
  const sub = strip.g.subarray(rowFrom * strip.nT, (rowFrom + nRows) * strip.nT);
  const resp = { r: absConvolveRows(sub, strip.nT, nRows, DOG_WIDE), nT: strip.nT, nS: nRows };
  const prof = alongProfile(resp, 0, nRows);
  const peaks = pickWires(prof, valid, strip.t0, { nmsRadius: 8, sigmaMultiplier: 3, normalize: true });
  const out: WireDetection[] = [];
  for (const p of peaks) {
    if (p.thicknessPx < 5) continue;
    if (thinWires.some((w) => Math.abs(w.t - p.t) < 5)) continue;
    out.push({ t: p.t, strength: 0.8 * p.strength, thicknessPx: p.thicknessPx });
  }
  return out;
}

/**
 * Angle correction from the drift of wire positions across rows. Each band
 * row near the reference row (the band's peakiest row, certainly on the
 * fingerboard) is cross-correlated with it over all valid columns; the lag
 * grows linearly with the across distance, and the weighted slope gives the
 * tilt. Rows off the fingerboard correlate poorly and get little weight.
 * Returns radians to ADD to the strip angle for a right-handed (dir, normal)
 * basis, or null.
 */
export function estimateTilt(
  resp: BandResponse,
  band: [number, number],
  rowStep: number,
  peakiness: Float32Array,
  valid: Uint8Array,
  maxTiltRad = 0.35,
  maxRows = 40,
): number | null {
  const { r, nT } = resp;
  let j0 = band[0];
  for (let j = band[0]; j <= band[1]; j++) if (peakiness[j] > peakiness[j0]) j0 = j;
  const n = nT;
  const ref = new Float32Array(n);
  let mean = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const v = r[j0 * nT + i];
    ref[i] = valid[i] && v === v ? v : 0;
    if (valid[i]) {
      mean += ref[i];
      cnt++;
    }
  }
  if (cnt < 60) return null;
  mean /= cnt;
  let refNorm = 0;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    ref[i] -= mean;
    refNorm += ref[i] * ref[i];
  }
  if (refNorm <= 1e-9) return null;
  const row = new Float32Array(n);
  const pts: Array<{ ds: number; lag: number; w: number }> = [];
  const jFrom = Math.max(band[0], j0 - maxRows);
  const jTo = Math.min(band[1], j0 + maxRows);
  for (let j = jFrom; j <= jTo; j++) {
    if (j === j0) continue;
    const ds = (j - j0) * rowStep;
    const maxLag = Math.max(1, Math.min(Math.ceil(Math.tan(maxTiltRad) * Math.abs(ds)) + 1, Math.floor(n / 4)));
    let m = 0;
    for (let i = 0; i < n; i++) {
      const v = r[j * nT + i];
      row[i] = valid[i] && v === v ? v : 0;
      m += row[i];
    }
    m /= cnt;
    let rowNorm = 0;
    for (let i = 0; i < n; i++) {
      if (!valid[i]) continue;
      row[i] -= m;
      rowNorm += row[i] * row[i];
    }
    if (rowNorm <= 1e-9) continue;
    const corrs = new Float64Array(2 * maxLag + 1);
    let best = -Infinity;
    let bestLag = 0;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let acc = 0;
      const from = Math.max(0, -lag);
      const to = Math.min(n, n - lag);
      for (let i = from; i < to; i++) acc += ref[i] * row[i + lag];
      const corr = acc / Math.sqrt(refNorm * rowNorm);
      corrs[lag + maxLag] = corr;
      if (corr > best) {
        best = corr;
        bestLag = lag;
      }
    }
    if (!(best > 0.15)) continue;
    let lag = bestLag;
    if (bestLag > -maxLag && bestLag < maxLag) {
      const a = corrs[bestLag - 1 + maxLag];
      const b = best;
      const c = corrs[bestLag + 1 + maxLag];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-12) lag += (0.5 * (a - c)) / denom;
    }
    pts.push({ ds, lag, w: best });
  }
  if (pts.length < 3) return null;
  // Weighted least squares through the origin: lag = slope · ds.
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += p.w * p.ds * p.lag;
    den += p.w * p.ds * p.ds;
  }
  if (den <= 1e-9) return null;
  const slope = num / den;
  // row[i + lag] ≈ ref[i] ⇒ wires in that row sit at t − lag relative to the reference row.
  return Math.atan(-slope);
}
