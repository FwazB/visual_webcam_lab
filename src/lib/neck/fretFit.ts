// Fit the exponential fret law (with a 1D projective term) to detected wire
// positions, and label them with absolute fret indices.
//
//   t(n) = (A + B·f(n)) / (1 + C·f(n)),   f(n) = 1 − ρ^n
//
// Gap ratios alone cannot fix the absolute index (scale degeneracy), so the
// geometric score only anchors the labelling through the nut-side/bridge-side
// penalties; other anchors (dots, width, tracking, audio) live elsewhere.

import { RHO, fretFraction } from "@/lib/instrument/profile";
import type { FretFit, WireDetection } from "./types";

export type Orientation = 1 | -1;

export interface FitInput {
  /** Wires in the strip axis frame (t along the strip direction). */
  wires: WireDetection[];
  /** Column validity in the strip frame. */
  valid: (t: number) => boolean;
  /** Valid extent of the strip in the strip frame. */
  tRange: [number, number];
  fretCount: number;
}

export interface FitResult {
  orientation: Orientation;
  /** Fit in the oriented frame: t' = orientation · t. */
  fit: FretFit;
  /** Wires (oriented t) with assigned n. */
  assigned: WireDetection[];
  score: number;
  rms: number;
  inlierCount: number;
}

export function predictT(fit: FretFit, n: number): number {
  const f = fretFraction(n);
  return (fit.A + fit.B * f) / (1 + fit.C * f);
}

/** Inverse of predictT: fractional fret index at oriented position t, or NaN. */
export function invertT(fit: FretFit, t: number): number {
  const denom = fit.B - fit.C * (t - fit.A);
  if (denom <= 1e-9) return NaN;
  const f = (t - fit.A) / denom;
  if (f >= 1) return NaN;
  return -12 * Math.log2(1 - f);
}

/** Relabel: the wire formerly called n is now called n + delta. */
export function relabelFit(fit: FretFit, delta: number): FretFit {
  if (delta === 0) return fit;
  const a = Math.pow(RHO, -delta);
  const b = 1 - a;
  const d = 1 + fit.C * b;
  return {
    A: (fit.A + fit.B * b) / d,
    B: (fit.B * a) / d,
    C: (fit.C * a) / d,
  };
}

/** Move the fit origin by `shift` along the axis (t_new = t_old − shift). */
export function shiftFitOrigin(fit: FretFit, shift: number): FretFit {
  return { A: fit.A - shift, B: fit.B - shift * fit.C, C: fit.C };
}

interface Scored {
  score: number;
  rms: number;
  matches: Array<{ wire: number; n: number; res: number; tau: number }>;
}

const STRONG = 0.5;

const MAX_FRETS = 30;
const F_TABLE = new Float64Array(MAX_FRETS + 1);
for (let n = 0; n <= MAX_FRETS; n++) F_TABLE[n] = fretFraction(n);
const PRED = new Float64Array(MAX_FRETS + 1);
const TAU = new Float64Array(MAX_FRETS + 1);
const MATCHED = new Uint8Array(MAX_FRETS + 1);

function predictFast(fit: FretFit, n: number): number {
  const f = F_TABLE[n];
  return (fit.A + fit.B * f) / (1 + fit.C * f);
}

const NO_MATCHES: Scored["matches"] = [];

function scoreFit(
  fit: FretFit,
  wires: WireDetection[],
  valid: (tOriented: number) => boolean,
  fretCount: number,
  collect = true,
): Scored {
  const pred = PRED;
  const tau = TAU;
  for (let m = 0; m <= fretCount; m++) pred[m] = predictFast(fit, m);
  if (!(pred[fretCount] > pred[0])) return { score: -Infinity, rms: Infinity, matches: [] };
  for (let m = 0; m <= fretCount; m++) {
    const gap = m === 0 ? pred[1] - pred[0] : pred[m] - pred[m - 1];
    tau[m] = Math.max(1.5, 0.06 * Math.abs(gap));
  }

  const matched = MATCHED;
  matched.fill(0, 0, fretCount + 1);
  const matches: Scored["matches"] = collect ? [] : NO_MATCHES;
  let score = 0;
  let sq = 0;
  let m = 0; // wires are sorted by t, predictions are increasing: walk both.
  for (let i = 0; i < wires.length; i++) {
    const w = wires[i];
    while (m < fretCount && pred[m + 1] <= w.t) m++;
    // Candidates: m and m+1.
    let bestM = m;
    let bestRes = w.t - pred[m];
    if (m < fretCount) {
      const r2 = w.t - pred[m + 1];
      if (Math.abs(r2) < Math.abs(bestRes)) {
        bestM = m + 1;
        bestRes = r2;
      }
    }
    const absRes = bestRes < 0 ? -bestRes : bestRes;
    if (absRes <= 2 * tau[bestM]) {
      matched[bestM] = 1;
      if (collect) matches.push({ wire: i, n: bestM, res: bestRes, tau: tau[bestM] });
      const z = bestRes / tau[bestM];
      score += w.strength * Math.exp(-z * z);
      sq += bestRes * bestRes;
    } else if (w.strength > STRONG) {
      score -= 0.2;
      if (w.t < pred[0] - 2 * tau[0]) score -= 1.0;
      if (w.t > pred[fretCount] + 2 * tau[fretCount]) score -= 1.0;
    }
  }
  for (let k = 0; k <= fretCount; k++) {
    if (!matched[k] && valid(pred[k])) score -= 0.3;
  }
  const rms = matches.length > 0 ? Math.sqrt(sq / matches.length) : Infinity;
  return { score, rms, matches };
}

/** Weighted least squares for (A, B) at fixed C over matched (t, n) pairs. */
function solveAB(
  C: number,
  pairs: Array<{ t: number; n: number; w: number }>,
): { A: number; B: number } | null {
  let sw = 0, sf = 0, sff = 0, sy = 0, sfy = 0;
  for (const p of pairs) {
    const f = fretFraction(p.n);
    const y = p.t * (1 + C * f);
    sw += p.w;
    sf += p.w * f;
    sff += p.w * f * f;
    sy += p.w * y;
    sfy += p.w * f * y;
  }
  const det = sw * sff - sf * sf;
  if (Math.abs(det) < 1e-9) return null;
  const B = (sw * sfy - sf * sy) / det;
  const A = (sy - B * sf) / sw;
  if (!(B > 0)) return null;
  return { A, B };
}

function residualSum(fit: FretFit, pairs: Array<{ t: number; n: number; w: number }>): number {
  let s = 0;
  for (const p of pairs) {
    const r = p.t - predictT(fit, p.n);
    s += p.w * r * r;
  }
  return s;
}

function refine(
  fit0: FretFit,
  wires: WireDetection[],
  valid: (t: number) => boolean,
  fretCount: number,
): { fit: FretFit; scored: Scored } {
  let fit = fit0;
  let scored = scoreFit(fit, wires, valid, fretCount);
  for (let iter = 0; iter < 3; iter++) {
    if (scored.matches.length < 2) break;
    const pairs = scored.matches.map((m) => ({
      t: wires[m.wire].t,
      n: m.n,
      w: wires[m.wire].strength * Math.exp(-((m.res / m.tau) ** 2)),
    }));
    // Golden-section search on C.
    let lo = -0.6;
    let hi = 0.6;
    const gr = (Math.sqrt(5) - 1) / 2;
    const evalC = (C: number) => {
      const ab = solveAB(C, pairs);
      if (!ab) return { cost: Infinity, fit: null as FretFit | null };
      const f = { A: ab.A, B: ab.B, C };
      return { cost: residualSum(f, pairs), fit: f };
    };
    let c1 = hi - gr * (hi - lo);
    let c2 = lo + gr * (hi - lo);
    let e1 = evalC(c1);
    let e2 = evalC(c2);
    for (let k = 0; k < 18; k++) {
      if (e1.cost < e2.cost) {
        hi = c2;
        c2 = c1;
        e2 = e1;
        c1 = hi - gr * (hi - lo);
        e1 = evalC(c1);
      } else {
        lo = c1;
        c1 = c2;
        e1 = e2;
        c2 = lo + gr * (hi - lo);
        e2 = evalC(c2);
      }
    }
    const best = e1.cost < e2.cost ? e1 : e2;
    if (!best.fit) break;
    const next = scoreFit(best.fit, wires, valid, fretCount);
    if (next.score < scored.score - 1e-6) break;
    fit = best.fit;
    scored = next;
  }
  return { fit, scored };
}

/**
 * Fit the fret law for one orientation. Enumerates structured hypotheses
 * (pair of detections ↔ fret indices n, n+Δ; a small set of C values),
 * scores all, refines the top few.
 */
export function fitFretLaw(input: FitInput, orientation: Orientation): FitResult | null {
  const { fretCount } = input;
  const wires = input.wires
    .map((w) => ({ ...w, t: orientation * w.t }))
    .sort((a, b) => a.t - b.t);
  if (wires.length < 2) return null;
  const valid = (tOriented: number) => input.valid(orientation * tOriented);

  const C_SET = [-0.4, -0.2, 0.2, 0.4];
  const hyps: Array<{ fit: FretFit; score: number; ta: number; tb: number; n: number; dn: number }> = [];
  const solve = (ta: number, tb: number, n: number, dn: number, C: number): FretFit | null => {
    const fa = F_TABLE[n];
    const fb = F_TABLE[n + dn];
    const B = (tb - ta + C * (tb * fb - ta * fa)) / (fb - fa);
    if (!(B > 0)) return null;
    return { A: ta * (1 + C * fa) - B * fa, B, C };
  };
  for (let i = 0; i < wires.length - 1; i++) {
    for (const dn of [1, 2]) {
      const j = i + dn;
      if (j >= wires.length) continue;
      const ta = wires[i].t;
      const tb = wires[j].t;
      for (let n = 0; n + dn <= fretCount; n++) {
        const fit = solve(ta, tb, n, dn, 0);
        if (!fit) continue;
        const s = scoreFit(fit, wires, valid, fretCount, false);
        if (s.score > -Infinity) hyps.push({ fit, score: s.score, ta, tb, n, dn });
      }
    }
  }
  hyps.sort((a, b) => b.score - a.score);
  // Expand the projective term only around the most promising labellings.
  const expanded: Array<{ fit: FretFit; score: number }> = hyps.slice(0, 12);
  for (const h of hyps.slice(0, 12)) {
    for (const C of C_SET) {
      const fit = solve(h.ta, h.tb, h.n, h.dn, C);
      if (!fit) continue;
      const s = scoreFit(fit, wires, valid, fretCount, false);
      if (s.score > -Infinity) expanded.push({ fit, score: s.score });
    }
  }
  expanded.sort((a, b) => b.score - a.score);
  if (expanded.length === 0) return null;

  let best: { fit: FretFit; scored: Scored } | null = null;
  for (const h of expanded.slice(0, 5)) {
    const r = refine(h.fit, wires, valid, fretCount);
    if (!best || r.scored.score > best.scored.score) best = r;
  }
  if (!best) return null;

  const assigned: WireDetection[] = best.scored.matches.map((m) => ({
    ...wires[m.wire],
    n: m.n,
  }));
  return {
    orientation,
    fit: best.fit,
    assigned,
    score: best.scored.score,
    rms: best.scored.rms,
    inlierCount: assigned.length,
  };
}

/** Re-score an (already oriented) fit; used for kCandidates. */
export function geometricScore(
  fit: FretFit,
  orientedWires: WireDetection[],
  valid: (tOriented: number) => boolean,
  fretCount: number,
): number {
  return scoreFit(fit, orientedWires, valid, fretCount).score;
}

/**
 * Nut anchor: is there a thick detection at predicted wire 0 with nothing
 * nut-ward of it? Returns 0..1.
 */
export function nutScore(
  fit: FretFit,
  orientedWires: WireDetection[],
  valid: (tOriented: number) => boolean,
  tRangeOriented: [number, number],
): number {
  const t0 = predictT(fit, 0);
  const gap0 = predictT(fit, 1) - t0;
  if (!(gap0 > 0)) return 0;
  if (t0 - 1.5 * gap0 < tRangeOriented[0] || t0 > tRangeOriented[1]) return 0;
  if (!valid(t0)) return 0;
  const tau = Math.max(1.5, 0.06 * gap0);
  const thicknesses = orientedWires.map((w) => w.thicknessPx).sort((a, b) => a - b);
  const medianThick = thicknesses.length ? thicknesses[Math.floor(thicknesses.length / 2)] : 1;
  let at: WireDetection | null = null;
  let nutward = 0;
  for (const w of orientedWires) {
    if (Math.abs(w.t - t0) <= 2 * tau) {
      if (!at || Math.abs(w.t - t0) < Math.abs(at.t - t0)) at = w;
    } else if (w.t < t0 && w.t > t0 - 2 * gap0 && w.strength > 0.35) {
      nutward++;
    }
  }
  if (!at || nutward > 0) return 0;
  return at.thicknessPx >= 1.8 * medianThick ? 1 : 0.4;
}
