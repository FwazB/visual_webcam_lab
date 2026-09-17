// Neck detection types. All geometry is in RAW frame pixels (un-mirrored,
// exactly what MediaPipe and getImageData see).

export interface Point {
  x: number;
  y: number;
}

/** RGBA frame as returned by getImageData. */
export interface RgbaFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Fret law along the neck axis with a 1D projective term for depth tilt:
 *   t(n) = (A + B·f(n)) / (1 + C·f(n)),  f(n) = 1 − ρ^n
 * `t` is the along-axis coordinate in pixels measured from the model origin.
 * A finished NeckModel is normalised so that its origin is the nut (A = 0).
 */
export interface FretFit {
  A: number;
  B: number;
  C: number;
}

/** Across-axis coordinate of a neck edge as a function of t: s(t) = s0 + slope·t. */
export interface EdgeLine {
  s0: number;
  slope: number;
}

export interface WireDetection {
  /** Along-axis position (px, in the observation's axis frame). */
  t: number;
  /** Peak prominence, normalised so the strongest wire is 1. */
  strength: number;
  /** Width at half maximum (px). The nut is 2–3× a wire. */
  thicknessPx: number;
  /** Assigned fret index once fitted. */
  n?: number;
}

export interface NeckModel {
  frameW: number;
  frameH: number;
  /** Nut point on the axis (may lie outside the frame). */
  origin: Point;
  /** Unit vector nut → bridge. */
  dir: Point;
  /** Unit vector string 0 (lowest pitch) → string N−1. */
  normal: Point;
  /** Fit with A = 0 (origin is the nut). */
  fit: FretFit;
  /** Edge on the string-0 side, in axis coordinates relative to `origin`. */
  topEdge: EdgeLine;
  bottomEdge: EdgeLine;
  assignedWires: WireDetection[];
  /** Net user/audio fret relabels applied (audit trail). */
  fretOffsetK: number;
  orientationFlipped: boolean;
  /** 0..1 geometric confidence. */
  confidence: number;
  /** 0..1 confidence in the absolute fret numbering. */
  kConfidence: number;
  /** Alternative labellings: relabel by `delta` scored by anchors. */
  kCandidates: Array<{ delta: number; score: number }>;
  updatedAt: number;
}

export interface NeckObservation {
  model: NeckModel | null;
  wires: WireDetection[];
  dots: Array<{ space: number; response: number }>;
  nutScore: number;
  orientationVotes: Record<string, number>;
  /** Hand-occluded along-axis interval in the observation's axis frame. */
  handMask: [number, number] | null;
  timingMs: number;
  reason?: string;
}

export type NeckTrackStatus =
  | "searching"
  | "acquiring"
  | "tracking"
  | "coasting"
  | "lost"
  | "locked";

export interface NeckPosition {
  /** Fractional fret index (wire units). */
  nFrac: number;
  /** Fret being pressed: space between wires fret−1 and fret. */
  fret: number;
  /** Position within the fret space, (0,1]; ~0.8 is just behind the wire. */
  inFret: number;
  stringFrac: number;
  string: number;
  onNeck: boolean;
}

/** Hand landmarks in frame pixels, with the fretting-hand priors. */
export interface HandPrior {
  /** All 21 landmarks in frame px. */
  points: Point[];
  /** Strip centre: mean of the PIP joints. */
  centre: Point;
  /** Unit direction estimate nut → bridge (pinky MCP − index MCP). */
  dir: Point;
  /** Index MCP → pinky MCP distance (px). */
  mcpDist: number;
  /** Direction the fingertips point relative to the knuckles (unit). */
  tipDir: Point;
}
