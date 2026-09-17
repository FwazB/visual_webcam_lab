// NeckModel helpers: wire geometry, pixel <-> neck coordinates, relabelling,
// and the display transform for object-cover video overlays.

import { fractionToFret, fretFraction, type InstrumentProfile } from "@/lib/instrument/profile";
import { relabelFit } from "./fretFit";
import type { EdgeLine, NeckModel, NeckPosition, Point } from "./types";

/** Along-axis position of wire n (origin = nut, A = 0). */
export function fretT(m: NeckModel, n: number): number {
  const f = fretFraction(n);
  return (m.fit.B * f) / (1 + m.fit.C * f);
}

/** Fractional fret index at along-axis position t, or NaN beyond the bridge. */
export function fretAtT(m: NeckModel, t: number): number {
  const denom = m.fit.B - m.fit.C * t;
  if (denom <= 1e-9) return NaN;
  const f = t / denom;
  if (f >= 1) return NaN;
  return fractionToFret(f);
}

export function edgeS(e: EdgeLine, t: number): number {
  return e.s0 + e.slope * t;
}

export function axisToPixel(m: NeckModel, t: number, s: number): Point {
  return {
    x: m.origin.x + m.dir.x * t + m.normal.x * s,
    y: m.origin.y + m.dir.y * t + m.normal.y * s,
  };
}

export function pixelToAxis(m: NeckModel, p: Point): { t: number; s: number } {
  const dx = p.x - m.origin.x;
  const dy = p.y - m.origin.y;
  return { t: dx * m.dir.x + dy * m.dir.y, s: dx * m.normal.x + dy * m.normal.y };
}

export function wireEndpoints(m: NeckModel, n: number): [Point, Point] {
  const t = fretT(m, n);
  return [axisToPixel(m, t, edgeS(m.topEdge, t)), axisToPixel(m, t, edgeS(m.bottomEdge, t))];
}

export function neckWidthAt(m: NeckModel, t: number): number {
  return edgeS(m.bottomEdge, t) - edgeS(m.topEdge, t);
}

/** Convert a frame pixel to (fret, string). */
export function pixelToNeck(m: NeckModel, profile: InstrumentProfile, p: Point): NeckPosition {
  const { t, s } = pixelToAxis(m, p);
  const nFrac = fretAtT(m, t);
  const top = edgeS(m.topEdge, t);
  const bot = edgeS(m.bottomEdge, t);
  const phi = (s - top) / Math.max(1e-6, bot - top);
  const inset = profile.stringInsetFraction;
  const stringFrac = ((phi - inset) / (1 - 2 * inset)) * (profile.stringCount - 1);
  const fret = Number.isNaN(nFrac) ? -1 : Math.max(0, Math.ceil(nFrac));
  const inFret = Number.isNaN(nFrac) ? 0 : nFrac - (fret - 1);
  const string = Math.round(stringFrac);
  const onNeck =
    !Number.isNaN(nFrac) &&
    nFrac >= -0.5 &&
    nFrac <= profile.fretCount + 0.5 &&
    phi >= -0.1 &&
    phi <= 1.1;
  return { nFrac, fret, inFret, stringFrac, string, onNeck };
}

/** Frame pixel for a (fret, string) target: inside the fret space, behind the wire. */
export function neckToPixel(
  m: NeckModel,
  profile: InstrumentProfile,
  fret: number,
  string: number,
  inFret = 0.65,
): Point {
  const t = fret <= 0 ? fretT(m, 0) - 0.4 * (fretT(m, 1) - fretT(m, 0)) : fretT(m, fret - 1 + inFret);
  const top = edgeS(m.topEdge, t);
  const bot = edgeS(m.bottomEdge, t);
  const inset = profile.stringInsetFraction;
  const phi = inset + ((1 - 2 * inset) * string) / Math.max(1, profile.stringCount - 1);
  return axisToPixel(m, t, top + phi * (bot - top));
}

/**
 * Relabel wires so that wire n becomes wire n + delta, keeping the origin at
 * the (new) nut.
 */
export function relabelFrets(m: NeckModel, delta: number): NeckModel {
  if (delta === 0) return m;
  const f = relabelFit(m.fit, delta);
  // New nut sits at t = f.A in the old frame; move the origin there.
  const shift = f.A;
  const origin = { x: m.origin.x + m.dir.x * shift, y: m.origin.y + m.dir.y * shift };
  return {
    ...m,
    origin,
    fit: { A: 0, B: f.B - shift * f.C, C: f.C },
    topEdge: { s0: m.topEdge.s0 + m.topEdge.slope * shift, slope: m.topEdge.slope },
    bottomEdge: { s0: m.bottomEdge.s0 + m.bottomEdge.slope * shift, slope: m.bottomEdge.slope },
    assignedWires: m.assignedWires.map((w) => ({
      ...w,
      t: w.t - shift,
      n: w.n === undefined ? undefined : w.n + delta,
    })),
    fretOffsetK: m.fretOffsetK + delta,
    kCandidates: m.kCandidates.map((c) => ({ delta: c.delta - delta, score: c.score })),
  };
}

export interface CoverTransform {
  scale: number;
  ox: number;
  oy: number;
  mirror: boolean;
  toDisplay: (p: Point) => Point;
  toFrame: (p: Point) => Point;
}

/**
 * Mapping between raw frame pixels and a container that shows the video with
 * `object-fit: cover` (optionally mirrored with scaleX(-1)).
 */
export function getCoverTransform(
  frameW: number,
  frameH: number,
  w: number,
  h: number,
  mirror: boolean,
): CoverTransform {
  const scale = Math.max(w / frameW, h / frameH);
  const ox = (w - frameW * scale) / 2;
  const oy = (h - frameH * scale) / 2;
  return {
    scale,
    ox,
    oy,
    mirror,
    toDisplay: (p) => {
      const x = p.x * scale + ox;
      return { x: mirror ? w - x : x, y: p.y * scale + oy };
    },
    toFrame: (p) => {
      const x = mirror ? w - p.x : p.x;
      return { x: (x - ox) / scale, y: (p.y - oy) / scale };
    },
  };
}
