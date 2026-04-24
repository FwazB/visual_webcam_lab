// Hand-inferred fretboard.
// Computes a local 4-fret × 4-string grid aligned with the player's fretting hand
// using MediaPipe hand landmarks — no user calibration required.

import type { NormalizedLandmark } from "@/hooks/usePoseTracking";

export interface Point {
  x: number;
  y: number;
}

export interface HandFretboard {
  /** Pixel position of (fret=0, string=0) — the "nut/E" corner of the local grid. */
  origin: Point;
  /** Per-fret basis vector (pixels). Adding this moves +1 fret along the neck. */
  fretAxis: Point;
  /** Per-string basis vector (pixels). Adding this moves +1 string (toward G). */
  stringAxis: Point;
  /** Number of frets the local grid spans (typically 4, covering the hand's span). */
  fretCount: number;
  /** Number of strings the grid represents (4 for standard bass). */
  stringCount: number;
  /** 0..1 confidence that the hand is in a fretting pose. */
  confidence: number;
}

// MediaPipe hand landmark indices (https://ai.google.dev/mediapipe)
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;

/**
 * Infer a local fretboard from the currently visible fretting hand.
 *
 * Geometry assumption:
 *  - The MCP knuckle line (index MCP → pinky MCP) is parallel to the neck.
 *    Index is closer to the nut, pinky closer to the bridge, so +fret = from
 *    index MCP toward pinky MCP.
 *  - The strings lie below the knuckle line (camera-facing view), in the
 *    direction the fingertips curl toward.
 *  - The index-to-pinky MCP distance ≈ 3 frets worth of travel.
 *
 * Returns null if hand landmarks are missing or unusable.
 */
export function inferFretboard(
  landmarks: NormalizedLandmark[],
  canvasW: number,
  canvasH: number,
  mirrorX: boolean = true,
): HandFretboard | null {
  if (landmarks.length < 21) return null;

  const toPx = (lm: NormalizedLandmark): Point => ({
    x: mirrorX ? (1 - lm.x) * canvasW : lm.x * canvasW,
    y: lm.y * canvasH,
  });

  const indexMcp = toPx(landmarks[INDEX_MCP]);
  const pinkyMcp = toPx(landmarks[PINKY_MCP]);
  const middleMcp = toPx(landmarks[MIDDLE_MCP]);
  const indexTip = toPx(landmarks[INDEX_TIP]);
  const middleTip = toPx(landmarks[MIDDLE_TIP]);
  const ringTip = toPx(landmarks[RING_TIP]);
  const pinkyTip = toPx(landmarks[PINKY_TIP]);

  // Neck axis = index MCP → pinky MCP, spanning ~3 frets.
  const nx = pinkyMcp.x - indexMcp.x;
  const ny = pinkyMcp.y - indexMcp.y;
  const mcpDist = Math.hypot(nx, ny);
  if (mcpDist < 20) return null;

  const FRETS_PER_MCP_SPAN = 3;
  const fretWidth = mcpDist / FRETS_PER_MCP_SPAN;
  const fretAxis: Point = {
    x: (nx / mcpDist) * fretWidth,
    y: (ny / mcpDist) * fretWidth,
  };

  // String axis = perpendicular to neck axis, pointing toward the fingertips
  // (away from the back of the hand).
  const perpA: Point = { x: -fretAxis.y, y: fretAxis.x };
  const knuckleMid: Point = {
    x: (indexMcp.x + pinkyMcp.x) / 2,
    y: (indexMcp.y + pinkyMcp.y) / 2,
  };
  const tipMid: Point = {
    x: (indexTip.x + middleTip.x + ringTip.x + pinkyTip.x) / 4,
    y: (indexTip.y + middleTip.y + ringTip.y + pinkyTip.y) / 4,
  };
  const tipVec: Point = {
    x: tipMid.x - knuckleMid.x,
    y: tipMid.y - knuckleMid.y,
  };
  const dot = tipVec.x * perpA.x + tipVec.y * perpA.y;
  const dirSign = dot >= 0 ? 1 : -1;

  // String spacing ≈ 40% of fret width on a typical bass viewed at a normal angle.
  const STRING_TO_FRET_RATIO = 0.45;
  const stringSpacing = fretWidth * STRING_TO_FRET_RATIO;
  const stringAxis: Point = {
    x: perpA.x * dirSign * (stringSpacing / fretWidth),
    y: perpA.y * dirSign * (stringSpacing / fretWidth),
  };

  // Origin: anchor (fret=0, string=0) at the index MCP, with strings extending
  // from 0 (MCP line) toward +3 (fingertips). This puts typical fingertip
  // positions at string 1–3, which is where they'd physically be pressing.
  const origin: Point = { x: indexMcp.x, y: indexMcp.y };

  // Confidence heuristic: hands in fretting position usually have the 4 fingers
  // curled toward the neck, so fingertip spread across the MCP span should be
  // small relative to mcpDist. Also require decent scale.
  const tipSpread = Math.hypot(pinkyTip.x - indexTip.x, pinkyTip.y - indexTip.y);
  const tipToMcp = Math.hypot(tipMid.x - knuckleMid.x, tipMid.y - knuckleMid.y);
  const confidence = Math.max(
    0,
    Math.min(
      1,
      // Hand big enough in frame
      Math.min(1, mcpDist / 60) *
        // Fingertips reasonably aligned (not flailing)
        Math.min(1, 1 - Math.abs(tipSpread - mcpDist) / (mcpDist + 1)) *
        // Fingers curled forward (positive tip vector magnitude)
        Math.min(1, tipToMcp / (fretWidth * 0.4 + 1)),
    ),
  );

  return {
    origin,
    fretAxis,
    stringAxis,
    fretCount: 4,
    stringCount: 4,
    confidence,
  };
}

/** Convert (fret, string) local coords to pixel coords. */
export function fretToPixel(fb: HandFretboard, fret: number, string: number): Point {
  return {
    x: fb.origin.x + fret * fb.fretAxis.x + string * fb.stringAxis.x,
    y: fb.origin.y + fret * fb.fretAxis.y + string * fb.stringAxis.y,
  };
}

/** Convert a pixel coord to local (fret, string). Returns fractional values. */
export function pixelToFret(
  fb: HandFretboard,
  p: Point,
): { fret: number; string: number } {
  const { fretAxis: fa, stringAxis: sa, origin: o } = fb;
  const det = fa.x * sa.y - fa.y * sa.x;
  if (Math.abs(det) < 1e-6) return { fret: 0, string: 0 };
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const fret = (dx * sa.y - dy * sa.x) / det;
  const string = (fa.x * dy - fa.y * dx) / det;
  return { fret, string };
}

/**
 * Exponentially smooth two fretboards. Useful for per-frame stabilization.
 * Returns a new fretboard blended `α` toward `next`.
 */
export function smoothFretboard(
  prev: HandFretboard | null,
  next: HandFretboard,
  alpha: number = 0.35,
): HandFretboard {
  if (!prev) return next;
  const lerpP = (a: Point, b: Point): Point => ({
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
  });
  return {
    origin: lerpP(prev.origin, next.origin),
    fretAxis: lerpP(prev.fretAxis, next.fretAxis),
    stringAxis: lerpP(prev.stringAxis, next.stringAxis),
    fretCount: next.fretCount,
    stringCount: next.stringCount,
    confidence: prev.confidence + (next.confidence - prev.confidence) * alpha,
  };
}
