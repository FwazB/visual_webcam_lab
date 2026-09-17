// Fretting-hand selection and hand-derived priors for the neck detector.

import type { HandDetection, NormalizedLandmark } from "@/hooks/usePoseTracking";
import type { HandPrior, NeckModel, Point } from "./types";

export type TrackedHand = HandDetection;

/**
 * MediaPipe's handedness assumes a selfie-mirrored input. We feed the raw,
 * un-mirrored video, so the player's real LEFT hand is reported as "Right".
 * Verify on a real session by raising only the left hand and logging labels.
 */
export const FRETTING_HAND_LABEL = "Right";

// Landmark indices
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const RING_PIP = 14;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const WRIST = 0;
export const FINGERTIP_INDEX = { index: 8, middle: 12, ring: 16, pinky: 20 } as const;
export const FINGER_PIP_INDEX = { index: 6, middle: 10, ring: 14, pinky: 18 } as const;
export type FingerName = keyof typeof FINGERTIP_INDEX;

export function landmarksToFrame(lm: NormalizedLandmark[], frameW: number, frameH: number): Point[] {
  return lm.map((l) => ({ x: l.x * frameW, y: l.y * frameH }));
}

function distToAxis(model: NeckModel, p: Point): number {
  const dx = p.x - model.origin.x;
  const dy = p.y - model.origin.y;
  return Math.abs(dx * model.normal.x + dy * model.normal.y);
}

/**
 * Pick the fretting hand: prefer the expected handedness label with a decent
 * score; when ambiguous prefer the hand nearest the tracked neck axis; with
 * no model prefer the hand with larger raw x (the neck side for a
 * right-handed player facing the camera).
 */
export function selectFrettingHand(
  hands: TrackedHand[],
  frameW: number,
  frameH: number,
  model: NeckModel | null,
  swapHands = false,
): TrackedHand | null {
  const usable = hands.filter((h) => h.landmarks.length >= 21);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];
  const wanted = swapHands ? (FRETTING_HAND_LABEL === "Right" ? "Left" : "Right") : FRETTING_HAND_LABEL;
  const labelled = usable.filter((h) => h.label === wanted && h.score >= 0.8);
  if (labelled.length === 1) return labelled[0];
  const centre = (h: TrackedHand): Point => {
    const pts = landmarksToFrame(h.landmarks, frameW, frameH);
    return pts[MIDDLE_MCP];
  };
  if (model && model.confidence > 0.3) {
    return usable.reduce((best, h) =>
      distToAxis(model, centre(h)) < distToAxis(model, centre(best)) ? h : best,
    );
  }
  return usable.reduce((best, h) => (centre(h).x > centre(best).x ? h : best));
}

/** Hand-derived priors for the strip sampler. Returns null if the hand is too small. */
export function handPrior(hand: TrackedHand, frameW: number, frameH: number): HandPrior | null {
  const pts = landmarksToFrame(hand.landmarks, frameW, frameH);
  const idx = pts[INDEX_MCP];
  const pk = pts[PINKY_MCP];
  const mcpDist = Math.hypot(pk.x - idx.x, pk.y - idx.y);
  if (mcpDist < 20) return null;
  // Index MCP is nut-ward; nut → bridge is index → pinky.
  const dir = { x: (pk.x - idx.x) / mcpDist, y: (pk.y - idx.y) / mcpDist };
  const pips = [pts[INDEX_PIP], pts[MIDDLE_PIP], pts[RING_PIP], pts[PINKY_PIP]];
  const centre = {
    x: pips.reduce((a, p) => a + p.x, 0) / 4,
    y: pips.reduce((a, p) => a + p.y, 0) / 4,
  };
  const knuckle = { x: (idx.x + pk.x) / 2, y: (idx.y + pk.y) / 2 };
  const tips = [8, 12, 16, 20].map((i) => pts[i]);
  const tipMid = {
    x: tips.reduce((a, p) => a + p.x, 0) / 4,
    y: tips.reduce((a, p) => a + p.y, 0) / 4,
  };
  const tv = { x: tipMid.x - knuckle.x, y: tipMid.y - knuckle.y };
  const tl = Math.hypot(tv.x, tv.y) || 1;
  return {
    points: pts,
    centre,
    dir,
    mcpDist,
    tipDir: { x: tv.x / tl, y: tv.y / tl },
  };
}

/** Along-axis interval covered by the hand, in the frame of (origin, dir). */
export function handMaskInterval(prior: HandPrior, origin: Point, dir: Point): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of prior.points) {
    const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  const pad = 0.15 * prior.mcpDist;
  return [lo - pad, hi + pad];
}

/**
 * Heuristic press score per finger from landmark depth: a pressing fingertip
 * sits further from the camera than its PIP, and the PIP is flexed.
 * Exposed for UI/fusion; not gated on by default.
 */
export function pressScores(hand: TrackedHand): Record<FingerName, number> {
  const lm = hand.landmarks;
  const wrist = lm[WRIST];
  const mid = lm[MIDDLE_MCP];
  const palm = Math.hypot(wrist.x - mid.x, wrist.y - mid.y) || 1;
  const out = {} as Record<FingerName, number>;
  (Object.keys(FINGERTIP_INDEX) as FingerName[]).forEach((name) => {
    const tip = lm[FINGERTIP_INDEX[name]];
    const pip = lm[FINGER_PIP_INDEX[name]];
    const mcp = lm[FINGER_PIP_INDEX[name] - 1];
    const dz = (tip.z - pip.z) / palm;
    const zTerm = Math.max(0, Math.min(1, (dz - 0.05) / 0.25));
    // Flexion at the PIP: angle between MCP→PIP and PIP→TIP.
    const ax = pip.x - mcp.x, ay = pip.y - mcp.y;
    const bx = tip.x - pip.x, by = tip.y - pip.y;
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const cos = (ax * bx + ay * by) / (la * lb);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    const flexTerm = Math.max(0, Math.min(1, (angle - 20) / 40));
    out[name] = 0.5 * zTerm + 0.5 * flexTerm;
  });
  return out;
}
