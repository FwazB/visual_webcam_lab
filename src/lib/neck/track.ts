// Temporal tracking of the neck model: geometry smoothing, fret-label
// hysteresis, orientation hysteresis, lock/nudge controls.

import type { Orientation } from "./fretFit";
import { axisToPixel, fretAtT, fretT, pixelToAxis, relabelFrets } from "./model";
import type { NeckModel, NeckObservation, NeckTrackStatus } from "./types";

const K_MIN = -3;
const K_MAX = 3;
const K_BINS = K_MAX - K_MIN + 1;
/** A challenger labelling must beat the incumbent by this (per-observation score units). */
const SWITCH_MARGIN = 1.5;
/** Bonus given to the labelling chosen by audio fusion or the user. */
const CONFIRM_BONUS = 4;

export interface NeckTrackState {
  status: NeckTrackStatus;
  model: NeckModel | null;
  /** Accumulated relabel votes, index = delta − K_MIN, relative to `model`. */
  kAcc: Float32Array;
  challengerDelta: number;
  challengerStreak: number;
  orientationStreak: number;
  acquireStreak: number;
  lastObs: NeckObservation | null;
  lastGoodAt: number;
  /** User-forced orientation relative to the strip direction. */
  orientationPreference: Orientation | null;
  flipStrings: boolean;
  /** Drift monitoring while locked. */
  driftRms: number;
  driftSince: number | null;
  driftWarning: boolean;
}

export function createTrackState(): NeckTrackState {
  return {
    status: "searching",
    model: null,
    kAcc: new Float32Array(K_BINS),
    challengerDelta: 0,
    challengerStreak: 0,
    orientationStreak: 0,
    acquireStreak: 0,
    lastObs: null,
    lastGoodAt: 0,
    orientationPreference: null,
    flipStrings: false,
    driftRms: 0,
    driftSince: null,
    driftWarning: false,
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function angleOf(p: { x: number; y: number }): number {
  return Math.atan2(p.y, p.x);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Integer label offset (tracked − observed) for the same physical wire. */
function labelOffset(tracked: NeckModel, obs: NeckModel): number | null {
  for (const n of [5, 1, 9]) {
    const p = axisToPixel(tracked, fretT(tracked, n), 0);
    const { t } = pixelToAxis(obs, p);
    const nObs = fretAtT(obs, t);
    if (!Number.isNaN(nObs)) return Math.round(n - nObs);
  }
  return null;
}

function blendModel(tracked: NeckModel, obs: NeckModel, alpha: number, now: number): NeckModel {
  const a0 = angleOf(tracked.dir);
  const a1 = angleOf(obs.dir);
  const angle = a0 + wrapAngle(a1 - a0) * alpha;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  let normal = { x: -dir.y, y: dir.x };
  if (normal.x * obs.normal.x + normal.y * obs.normal.y < 0) normal = { x: -normal.x, y: -normal.y };
  return {
    ...obs,
    origin: { x: lerp(tracked.origin.x, obs.origin.x, alpha), y: lerp(tracked.origin.y, obs.origin.y, alpha) },
    dir,
    normal,
    fit: { A: 0, B: lerp(tracked.fit.B, obs.fit.B, alpha), C: lerp(tracked.fit.C, obs.fit.C, alpha) },
    topEdge: {
      s0: lerp(tracked.topEdge.s0, obs.topEdge.s0, alpha),
      slope: lerp(tracked.topEdge.slope, obs.topEdge.slope, alpha),
    },
    bottomEdge: {
      s0: lerp(tracked.bottomEdge.s0, obs.bottomEdge.s0, alpha),
      slope: lerp(tracked.bottomEdge.slope, obs.bottomEdge.slope, alpha),
    },
    fretOffsetK: tracked.fretOffsetK,
    orientationFlipped: tracked.orientationFlipped,
    confidence: lerp(tracked.confidence, obs.confidence, alpha),
    kConfidence: lerp(tracked.kConfidence, obs.kConfidence, 0.5),
    updatedAt: now,
  };
}

function shiftAcc(acc: Float32Array, delta: number): Float32Array {
  // After relabelling by `delta`, the old bin d corresponds to new bin d − delta.
  const out = new Float32Array(K_BINS);
  for (let d = K_MIN; d <= K_MAX; d++) {
    const nd = d - delta;
    if (nd >= K_MIN && nd <= K_MAX) out[nd - K_MIN] = acc[d - K_MIN];
  }
  return out;
}

/** Residual RMS of observed wire positions against the tracked model (px). */
function driftAgainst(tracked: NeckModel, obs: NeckModel): number {
  let sq = 0;
  let n = 0;
  for (const w of obs.assignedWires) {
    if (w.n === undefined) continue;
    const p = axisToPixel(obs, w.t, 0);
    const { t } = pixelToAxis(tracked, p);
    const nT = fretAtT(tracked, t);
    if (Number.isNaN(nT)) continue;
    const tExpect = fretT(tracked, Math.round(nT));
    sq += (t - tExpect) ** 2;
    n++;
  }
  return n ? Math.sqrt(sq / n) : 0;
}

/** Called when a detection tick produced no usable observation. */
export function coastNeckTrack(state: NeckTrackState, now: number): NeckTrackState {
  if (state.status === "locked") return state;
  if (!state.model) {
    state.status = "searching";
    return state;
  }
  state.model = { ...state.model, confidence: state.model.confidence * 0.97, updatedAt: now };
  state.acquireStreak = 0;
  state.status = state.model.confidence < 0.2 ? "lost" : "coasting";
  return state;
}

export function updateNeckTrack(state: NeckTrackState, obs: NeckObservation, now: number): NeckTrackState {
  state.lastObs = obs;
  const om = obs.model;
  if (!om || om.confidence < 0.25) return coastNeckTrack(state, now);

  if (state.status === "locked" && state.model) {
    const rms = driftAgainst(state.model, om);
    state.driftRms = rms;
    if (rms > 3) {
      state.driftSince ??= now;
      state.driftWarning = now - state.driftSince > 2000;
    } else {
      state.driftSince = null;
      state.driftWarning = false;
    }
    return state;
  }

  if (!state.model) {
    state.model = om;
    state.acquireStreak = 1;
    state.status = "acquiring";
    state.lastGoodAt = now;
    state.kAcc = new Float32Array(K_BINS);
    return state;
  }

  const tracked = state.model;
  // Orientation hysteresis.
  if (tracked.dir.x * om.dir.x + tracked.dir.y * om.dir.y < 0) {
    state.orientationStreak++;
    if (state.orientationStreak >= 5) {
      state.model = { ...om, orientationFlipped: !tracked.orientationFlipped };
      state.kAcc = new Float32Array(K_BINS);
      state.orientationStreak = 0;
      state.acquireStreak = 1;
      state.status = "acquiring";
    }
    return state;
  }
  state.orientationStreak = 0;

  const offset = labelOffset(tracked, om);
  if (offset === null) return coastNeckTrack(state, now);
  const aligned = Math.abs(offset) > 6 ? null : relabelFrets(om, offset);
  if (!aligned) {
    // Wildly different labelling: treat as a fresh acquisition candidate.
    state.model = om;
    state.kAcc = new Float32Array(K_BINS);
    state.acquireStreak = 1;
    state.status = "acquiring";
    return state;
  }

  const alpha = om.confidence > 0.5 ? 0.3 : 0.1;
  state.model = blendModel(tracked, aligned, alpha, now);
  state.lastGoodAt = now;

  // Fret-label votes: an EMA of each candidate labelling's anchor score
  // (aligned.kCandidates are relative to the tracked labelling).
  const EMA = 0.15;
  for (let i = 0; i < K_BINS; i++) state.kAcc[i] *= 1 - EMA;
  for (const c of aligned.kCandidates) {
    if (c.delta >= K_MIN && c.delta <= K_MAX) state.kAcc[c.delta - K_MIN] += EMA * c.score;
  }
  let bestD = 0;
  let bestV = -Infinity;
  for (let d = K_MIN; d <= K_MAX; d++) {
    const v = state.kAcc[d - K_MIN];
    if (v > bestV) {
      bestV = v;
      bestD = d;
    }
  }
  const incumbent = state.kAcc[-K_MIN];
  if (bestD !== 0 && bestV - incumbent > SWITCH_MARGIN) {
    if (state.challengerDelta === bestD) state.challengerStreak++;
    else {
      state.challengerDelta = bestD;
      state.challengerStreak = 1;
    }
    if (state.challengerStreak >= 3) {
      state.model = relabelFrets(state.model, bestD);
      state.kAcc = shiftAcc(state.kAcc, bestD);
      state.challengerStreak = 0;
      state.challengerDelta = 0;
    }
  } else {
    state.challengerStreak = 0;
    state.challengerDelta = 0;
  }

  state.acquireStreak++;
  state.status = state.acquireStreak >= 2 ? "tracking" : "acquiring";
  return state;
}

export function lockNeck(state: NeckTrackState, locked: boolean): void {
  if (locked && state.model) {
    state.status = "locked";
    state.driftSince = null;
    state.driftWarning = false;
  } else if (!locked && state.status === "locked") {
    state.status = state.model ? "tracking" : "searching";
  }
}

/**
 * Relabel the tracked model by `delta` (user nudge or audio fusion). The new
 * labelling is treated as confirmed: it gets a vote bonus so vision anchors
 * cannot immediately revert it, while a persistent disagreement still can.
 */
export function applyDeltaK(state: NeckTrackState, delta: number): void {
  if (!state.model || delta === 0) return;
  state.model = relabelFrets(state.model, delta);
  state.kAcc = shiftAcc(state.kAcc, delta);
  let best = 0;
  for (let i = 0; i < K_BINS; i++) best = Math.max(best, state.kAcc[i]);
  state.kAcc[-K_MIN] = best + CONFIRM_BONUS;
  state.challengerStreak = 0;
  state.challengerDelta = 0;
}

export function flipNeckOrientation(state: NeckTrackState): void {
  // Force the opposite strip orientation on the next detections and drop the model.
  const current = state.model ? (state.model.orientationFlipped ? -1 : 1) : 1;
  state.orientationPreference = (state.orientationPreference ?? current) === 1 ? -1 : 1;
  state.model = null;
  state.kAcc = new Float32Array(K_BINS);
  state.status = "searching";
}

export function flipNeckStrings(state: NeckTrackState): void {
  state.flipStrings = !state.flipStrings;
  if (state.model) {
    const m = state.model;
    state.model = {
      ...m,
      normal: { x: -m.normal.x, y: -m.normal.y },
      topEdge: { s0: -m.bottomEdge.s0, slope: -m.bottomEdge.slope },
      bottomEdge: { s0: -m.topEdge.s0, slope: -m.topEdge.slope },
    };
  }
}

export function resetNeck(state: NeckTrackState): void {
  const pref = state.orientationPreference;
  const flip = state.flipStrings;
  Object.assign(state, createTrackState());
  state.orientationPreference = pref;
  state.flipStrings = flip;
}
