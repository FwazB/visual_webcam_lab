// Neck detection orchestrator: hand/previous-model prior → axis angle
// refinement → rotated strip → 1D wire profile → fret-law fit → anchors →
// NeckModel. Pure over an RGBA frame so it can run inline or in a worker.

import { fretFraction, neckWidthMmAt, type InstrumentProfile } from "@/lib/instrument/profile";
import {
  fitFretLaw,
  geometricScore,
  nutScore,
  predictT,
  relabelFit,
  type FitResult,
  type Orientation,
} from "./fretFit";
import { handMaskInterval } from "./fretHand";
import { axisRangeInFrame, sampleStrip, type Strip } from "./image";
import { edgeS } from "./model";
import {
  alongProfile,
  bandFromEnergy,
  bandpassStrip,
  columnMask,
  estimateTilt,
  fitEdges,
  pickWideBars,
  pickWires,
  rowPeakiness,
  type BandResponse,
} from "./profile1d";
import type { EdgeLine, FretFit, HandPrior, NeckModel, NeckObservation, Point, RgbaFrame, WireDetection } from "./types";

export interface DetectOptions {
  profile: InstrumentProfile;
  hand: HandPrior | null;
  prevModel: NeckModel | null;
  /** Force an orientation relative to the strip direction (user "flip"). */
  orientationPreference?: Orientation | null;
  /** Force the string-side sign (user "flip strings"). */
  flipStrings?: boolean;
  now: number;
  /** Optional sink for intermediate values (dev panel / tests). */
  debug?: Record<string, unknown>;
}

const DEG = Math.PI / 180;

function unit(a: number): Point {
  return { x: Math.cos(a), y: Math.sin(a) };
}

function empty(reason: string, t0: number): NeckObservation {
  return {
    model: null,
    wires: [],
    dots: [],
    nutScore: 0,
    orientationVotes: {},
    handMask: null,
    timingMs: performance.now() - t0,
    reason,
  };
}

interface StripPlan {
  origin: Point;
  angle: number;
  /** Across range relative to origin. */
  s0: number;
  nS: number;
  /** Optional along-axis half extent around the origin (px); full frame if absent. */
  tSpan?: number;
}

interface StripAnalysis {
  strip: Strip;
  resp: BandResponse;
  valid: Uint8Array;
  validCols: number[];
  /** Fingerboard band rows [jTop, jBot] (inclusive), or null if not found. */
  band: [number, number] | null;
  /** Rows used for the along profile. */
  rows: [number, number];
  profile: Float32Array;
  wires: WireDetection[];
  peakiness: Float32Array;
}

/**
 * Sample a strip at `angle`, band-pass it, locate the fingerboard band from
 * row peakiness, and pick wire peaks from the in-band profile.
 */
function analyseStrip(
  frame: RgbaFrame,
  plan: StripPlan,
  angle: number,
  normal: Point,
  rowStep: number,
  masks: Array<[number, number]>,
  normalizeStrength = true,
): StripAnalysis | null {
  const dir = unit(angle);
  const range = axisRangeInFrame(frame, plan.origin, dir, 2);
  if (!range) return null;
  const lo = plan.tSpan ? Math.max(range[0], -plan.tSpan) : range[0];
  const hi = plan.tSpan ? Math.min(range[1], plan.tSpan) : range[1];
  const t0 = Math.ceil(lo);
  const nT = Math.floor(hi) - t0;
  if (nT < 40) return null;
  const nS = Math.max(4, Math.floor(plan.nS / rowStep));
  const strip = sampleStrip(frame, plan.origin, dir, normal, t0, nT, plan.s0, nS, rowStep);
  const resp = bandpassStrip(strip);
  const valid = columnMask(strip, masks);
  const validCols: number[] = [];
  for (let i = 0; i < nT; i++) if (valid[i]) validCols.push(i);
  if (validCols.length < 40) return null;
  // The strip origin lies on the fingerboard (hand PIPs / tracked axis), so
  // anchor the band on the row through s = 0.
  const anchorRow = Math.round((0 - plan.s0) / rowStep);
  const peakiness = rowPeakiness(resp, validCols);
  const band = bandFromEnergy(peakiness, 0.4, anchorRow);
  let rows: [number, number];
  if (band && band[1] - band[0] >= 4) {
    const margin = Math.round(0.15 * (band[1] - band[0]));
    rows = [band[0] + margin, band[1] - margin + 1];
  } else {
    rows = [Math.floor(nS * 0.2), Math.ceil(nS * 0.8)];
  }
  const profile = alongProfile(resp, rows[0], rows[1]);
  let wires = pickWires(profile, valid, t0, { normalize: normalizeStrength });
  if (rowStep === 1 && band) {
    wires = wires.concat(pickWideBars(strip, rows[0], rows[1], valid, wires)).sort((x, y) => x.t - y.t);
  }
  return { strip, resp, valid, validCols, band, rows, profile, wires, peakiness };
}

function columnsForWires(strip: Strip, wires: WireDetection[]): number[] {
  const cols: number[] = [];
  for (const w of wires) {
    const c = Math.round(w.t - strip.t0);
    for (let d = -1; d <= 1; d++) {
      const i = c + d;
      if (i >= 0 && i < strip.nT) cols.push(i);
    }
  }
  return cols;
}

function splitSegments<T>(items: T[], parts: number): T[][] {
  const out: T[][] = [];
  const per = Math.ceil(items.length / parts);
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

/** Inlay-dot response per fret space, in units of strip gray std. */
function dotResponses(
  strip: Strip,
  fitOriented: FretFit,
  orientation: Orientation,
  edges: { top: EdgeLine; bottom: EdgeLine },
  valid: (tStrip: number) => boolean,
  fretCount: number,
): Array<{ space: number; response: number }> {
  const { g, nT, nS, t0, s0 } = strip;
  // Global gray std for normalisation.
  let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < g.length; i += 7) {
    const v = g[i];
    if (!Number.isNaN(v)) {
      sum += v;
      sq += v * v;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  const std = n ? Math.sqrt(Math.max(1e-6, sq / n - mean * mean)) : 1;

  const out: Array<{ space: number; response: number }> = [];
  for (let m = 1; m <= fretCount; m++) {
    const ta = orientation * predictT(fitOriented, m - 1);
    const tb = orientation * predictT(fitOriented, m);
    const lo = Math.min(ta, tb);
    const hi = Math.max(ta, tb);
    const gap = hi - lo;
    if (gap < 6) continue;
    const cLo = lo + 0.25 * gap;
    const cHi = hi - 0.25 * gap;
    if (!valid(cLo) || !valid(cHi)) continue;
    const tc = (lo + hi) / 2;
    const top = edgeS(edges.top, tc);
    const bot = edgeS(edges.bottom, tc);
    const width = bot - top;
    if (width < 8) continue;
    const rowAt = (phi: number) => Math.round((top + phi * width - s0));
    const sampleRows = (phiFrom: number, phiTo: number) => {
      let s = 0, c = 0;
      const j0 = Math.max(0, rowAt(phiFrom));
      const j1 = Math.min(nS - 1, rowAt(phiTo));
      const i0 = Math.max(0, Math.round(cLo - t0));
      const i1 = Math.min(nT - 1, Math.round(cHi - t0));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = g[j * nT + i];
          if (!Number.isNaN(v)) {
            s += v;
            c++;
          }
        }
      }
      return c ? s / c : NaN;
    };
    const centre = sampleRows(0.38, 0.62);
    const off = (sampleRows(0.12, 0.3) + sampleRows(0.7, 0.88)) / 2;
    if (Number.isNaN(centre) || Number.isNaN(off)) continue;
    out.push({ space: m, response: Math.abs(centre - off) / std });
  }
  return out;
}

function dotScore(dots: Array<{ space: number; response: number }>, inlayFrets: number[], delta: number, thr = 0.8): number {
  const inlay = new Set(inlayFrets);
  let positives = 0;
  let score = 0;
  let count = 0;
  for (const d of dots) {
    const detected = d.response > thr;
    if (detected) positives++;
    const expected = inlay.has(d.space + delta);
    score += detected === expected ? 1 : -1;
    count++;
  }
  if (positives < 2 || count === 0) return 0;
  return score / count;
}

function widthScore(
  profile: InstrumentProfile,
  fitOriented: FretFit,
  orientation: Orientation,
  edges: { top: EdgeLine; bottom: EdgeLine },
  assigned: WireDetection[],
): number {
  if (assigned.length < 2) return 0;
  let acc = 0;
  let n = 0;
  for (const w of assigned) {
    if (w.n === undefined || w.n < 1) continue;
    const tPrev = predictT(fitOriented, w.n - 1);
    const tCur = predictT(fitOriented, w.n);
    const gapPx = tCur - tPrev;
    const tStrip = orientation * tCur;
    const widthPx = edgeS(edges.bottom, tStrip) - edgeS(edges.top, tStrip);
    if (!(gapPx > 0) || !(widthPx > 0)) continue;
    const gapMm = profile.scaleLengthMm * (fretFraction(w.n) - fretFraction(w.n - 1));
    const expected = gapMm / neckWidthMmAt(profile, w.n);
    acc += Math.log((gapPx / widthPx) / expected);
    n++;
  }
  if (n === 0) return 0;
  const meanLog = acc / n;
  return Math.exp(-((meanLog / 0.08) ** 2));
}

export function detectNeck(frame: RgbaFrame, opts: DetectOptions): NeckObservation {
  const tStart = performance.now();
  const timings: Record<string, number> = {};
  let tMark = tStart;
  const mark = (name: string) => {
    const now = performance.now();
    timings[name] = (timings[name] ?? 0) + (now - tMark);
    tMark = now;
  };
  const { profile, hand, prevModel } = opts;
  const usePrev = !!prevModel && prevModel.confidence > 0.4;

  // 1. Prior: strip origin, axis angle, across extent.
  let plan: StripPlan;
  if (usePrev && prevModel) {
    const range = axisRangeInFrame(frame, prevModel.origin, prevModel.dir, 2);
    if (!range) return empty("prev-model-off-frame", tStart);
    let tc = (range[0] + range[1]) / 2;
    if (hand) {
      const dx = hand.centre.x - prevModel.origin.x;
      const dy = hand.centre.y - prevModel.origin.y;
      tc = dx * prevModel.dir.x + dy * prevModel.dir.y;
    }
    const top = edgeS(prevModel.topEdge, tc);
    const bot = edgeS(prevModel.bottomEdge, tc);
    const w = Math.max(20, bot - top);
    const sc = (top + bot) / 2;
    const half = 0.75 * w + 20;
    // Strip origin on the axis at the band centre.
    const origin = {
      x: prevModel.origin.x + prevModel.normal.x * sc,
      y: prevModel.origin.y + prevModel.normal.y * sc,
    };
    plan = { origin, angle: Math.atan2(prevModel.dir.y, prevModel.dir.x), s0: -half, nS: Math.round(2 * half) };
  } else if (hand) {
    const half = Math.max(hand.mcpDist, 40);
    plan = { origin: hand.centre, angle: Math.atan2(hand.dir.y, hand.dir.x), s0: -half, nS: Math.round(2 * half) };
  } else {
    return empty("no-prior", tStart);
  }

  // String side: normal must point from string 0 (top of frame) toward string N−1.
  const setNormalFor = (angle: number): Point => {
    const d = unit(angle);
    let n: Point = { x: -d.y, y: d.x };
    if (usePrev && prevModel) {
      // Keep continuity with the tracked model.
      if (n.x * prevModel.normal.x + n.y * prevModel.normal.y < 0) n = { x: -n.x, y: -n.y };
    } else if (Math.abs(n.y) >= 0.5) {
      if (n.y < 0) n = { x: -n.x, y: -n.y };
    } else if (hand) {
      // Steep neck: fingertips point toward string 0.
      if (n.x * hand.tipDir.x + n.y * hand.tipDir.y > 0) n = { x: -n.x, y: -n.y };
    }
    if (opts.flipStrings) n = { x: -n.x, y: -n.y };
    return n;
  };
  const maskFor = (angle: number): Array<[number, number]> =>
    hand ? [handMaskInterval(hand, plan.origin, unit(angle))] : [];

  // 2–4. Angle refinement by measuring the wire tilt inside the band: a
  //      mis-aligned axis makes wire positions drift across the band rows.
  //      Two passes at row stride 2, each narrowing the across extent.
  let bestAngle = plan.angle;
  const tiltHistory: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const a = analyseStrip(frame, { ...plan, tSpan: 420 }, bestAngle, setNormalFor(bestAngle), 2, maskFor(bestAngle), false);
    if (!a) return empty("strip-off-frame", tStart);
    if (a.band) {
      const sTop = a.strip.s0 + a.band[0] * 2;
      const sBot = a.strip.s0 + a.band[1] * 2;
      const w = Math.max(16, sBot - sTop);
      plan = { ...plan, s0: sTop - 0.5 * w, nS: Math.round(2 * w) };
      // estimateTilt assumes a right-handed (dir, normal) basis; flip the sign otherwise.
      const d = unit(bestAngle);
      const n = setNormalFor(bestAngle);
      const handed = d.x * n.y - d.y * n.x > 0 ? 1 : -1;
      const tilt = estimateTilt(a.resp, a.band, 2, a.peakiness, a.valid);
      if (tilt !== null) {
        const corr = handed * tilt;
        tiltHistory.push(corr);
        bestAngle += corr;
        if (Math.abs(corr) < 0.3 * DEG) break;
      }
    }
    mark(`tilt${pass}`);
  }
  const normal = setNormalFor(bestAngle);
  const masks = maskFor(bestAngle);
  if (opts.debug) Object.assign(opts.debug, { planOrigin: plan.origin, priorAngle: plan.angle, tiltHistory, bestAngle, masks, planRows: [plan.s0, plan.nS] });

  // 5. Full-resolution strip at the best angle.
  const A = analyseStrip(frame, plan, bestAngle, normal, 1, masks);
  mark("finalStrip");
  if (!A) return empty("strip-off-frame", tStart);
  const { strip, resp, valid, validCols, wires } = A;
  const dirStrip = unit(bestAngle);
  const isValid = (t: number) => {
    const i = Math.round(t - strip.t0);
    return i >= 0 && i < strip.nT && valid[i] === 1;
  };
  let edges = A.band
    ? fitEdges(resp, strip, splitSegments(validCols, 3), 1, "peak")
    : null;
  if (opts.debug) Object.assign(opts.debug, { strip: { t0: strip.t0, nT: strip.nT, s0: strip.s0, nS: strip.nS }, band: A.band, wiresRaw: wires, edges1: edges });
  if (wires.length < 2) return { ...empty("too-few-wires", tStart), wires };

  // 6. Fit both orientations, vote.
  const tRange: [number, number] = [strip.t0, strip.t0 + strip.nT - 1];
  const orientations: Orientation[] = opts.orientationPreference ? [opts.orientationPreference] : [1, -1];
  const votes: Record<string, number> = {};
  let best: { res: FitResult; total: number; nut: number } | null = null;
  for (const o of orientations) {
    const res = fitFretLaw({ wires, valid: isValid, tRange, fretCount: profile.fretCount }, o);
    if (!res) continue;
    const orientedWires = wires.map((w) => ({ ...w, t: o * w.t }));
    const rangeO: [number, number] = o === 1 ? tRange : [-tRange[1], -tRange[0]];
    const nut = nutScore(res.fit, orientedWires, (t) => isValid(o * t), rangeO);
    const dirO = { x: o * dirStrip.x, y: o * dirStrip.y };
    const handAgree = hand ? (dirO.x * hand.dir.x + dirO.y * hand.dir.y > 0 ? 1 : -1) : 0;
    const total = res.score + 1.0 * handAgree + 2.0 * nut;
    votes[o === 1 ? "+1" : "-1"] = total;
    if (!best || total > best.total) best = { res, total, nut };
  }
  mark("fit");
  if (!best) return { ...empty("fit-failed", tStart), wires };
  if (opts.debug) Object.assign(opts.debug, { fitVotes: votes, fitBest: best });
  const o = best.res.orientation;
  let fitO = best.res.fit;
  let assigned = best.res.assigned;

  // 7. Second-pass edges specific to the fitted wires.
  const wireCols = columnsForWires(strip, wires.filter((w) => assigned.some((a) => Math.abs(a.t - o * w.t) < 1e-6)));
  const edges2 = wireCols.length >= 6 ? fitEdges(resp, strip, splitSegments(wireCols, 3), 1, "mean") : null;
  if (edges2) edges = edges2;
  if (!edges) {
    // Fall back to a constant band spanning the strip.
    edges = {
      top: { s0: strip.s0 + strip.nS * 0.15, slope: 0 },
      bottom: { s0: strip.s0 + strip.nS * 0.85, slope: 0 },
      halfWidth: strip.nS * 0.35,
    };
  }

  // 8. Anchors → kCandidates over relabels δ ∈ [−3, 3].
  const orientedWires = wires.map((w) => ({ ...w, t: o * w.t }));
  const rangeO: [number, number] = o === 1 ? tRange : [-tRange[1], -tRange[0]];
  const validO = (t: number) => isValid(o * t);
  const dots = dotResponses(strip, fitO, o, edges, isValid, profile.fretCount);
  const dotPositives = dots.filter((d) => d.response > 0.8).length;
  const dotWeight = dotPositives >= 3 ? 2.5 : 1.5;
  const candidates: Array<{ delta: number; score: number; nut: number }> = [];
  for (let delta = -3; delta <= 3; delta++) {
    const f = relabelFit(fitO, delta);
    const geom = geometricScore(f, orientedWires, validO, profile.fretCount);
    if (geom === -Infinity) continue;
    const nut = nutScore(f, orientedWires, validO, rangeO);
    const dScore = dotScore(dots, profile.inlayFrets, delta);
    const assignedShifted = assigned.map((w) => ({ ...w, n: (w.n ?? 0) + delta }));
    const wScore = widthScore(profile, f, o, edges, assignedShifted);
    candidates.push({ delta, score: geom + 2.0 * nut + dotWeight * dScore + 0.5 * wScore, nut });
  }
  if (candidates.length === 0) return { ...empty("no-candidates", tStart), wires };
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  mark("anchors");
  if (opts.debug) Object.assign(opts.debug, { candidates, edges2: edges, dots, timings });
  if (chosen.delta !== 0) {
    fitO = relabelFit(fitO, chosen.delta);
    assigned = assigned.map((w) => ({ ...w, n: (w.n ?? 0) + chosen.delta }));
  }
  const second = candidates[1]?.score ?? chosen.score - 2;
  const anchorPresence = chosen.nut > 0 || dots.filter((d) => d.response > 0.8).length >= 2 ? 1 : 0.5;
  const kConfidence = Math.max(0, Math.min(1, (chosen.score - second) / 2)) * anchorPresence;

  // 9. Assemble the model with the origin at the nut.
  const nutT = fitO.A; // oriented frame
  const originNut = {
    x: plan.origin.x + dirStrip.x * o * nutT,
    y: plan.origin.y + dirStrip.y * o * nutT,
  };
  const dir = { x: o * dirStrip.x, y: o * dirStrip.y };
  const fit: FretFit = { A: 0, B: fitO.B - nutT * fitO.C, C: fitO.C };
  // Edges: strip frame t_strip = o·(t_model + nutT).
  const toModelEdge = (e: EdgeLine): EdgeLine => ({ s0: e.s0 + e.slope * o * nutT, slope: e.slope * o });
  const topEdge = toModelEdge(edges.top);
  const bottomEdge = toModelEdge(edges.bottom);

  const wireTerm = Math.min(1, assigned.length / 6);
  const rmsTerm = best.res.rms <= 1 ? 1 : Math.max(0, 1 - (best.res.rms - 1) / 3);
  const bandTerm = edges2 ? 1 : 0.6;
  const confidence = Math.max(0, Math.min(1, wireTerm * rmsTerm * bandTerm));

  const model: NeckModel = {
    frameW: frame.width,
    frameH: frame.height,
    origin: originNut,
    dir,
    normal,
    fit,
    topEdge,
    bottomEdge,
    assignedWires: assigned.map((w) => ({ ...w, t: w.t - nutT })),
    fretOffsetK: 0,
    orientationFlipped: false,
    confidence,
    kConfidence,
    kCandidates: candidates.map((c) => ({ delta: c.delta - chosen.delta, score: c.score })),
    updatedAt: opts.now,
  };

  return {
    model,
    wires,
    dots,
    nutScore: chosen.nut,
    orientationVotes: votes,
    handMask: masks[0] ?? null,
    timingMs: performance.now() - tStart,
  };
}
