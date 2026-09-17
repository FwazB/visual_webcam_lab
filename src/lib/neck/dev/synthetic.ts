// Synthetic neck renderer for repeatable detector tests (browser or Node).

import { GUITAR_STANDARD, fretFraction, neckWidthMmAt, type InstrumentProfile } from "@/lib/instrument/profile";
import type { HandPrior, Point, RgbaFrame } from "../types";

export interface SyntheticParams {
  width?: number;
  height?: number;
  profile?: InstrumentProfile;
  /** Nut position in frame px. */
  nut?: Point;
  /** Axis angle (radians), nut → bridge. */
  angle?: number;
  /** Pixel scale: B in t(n) = B f / (1 + C f). */
  B?: number;
  C?: number;
  /** Neck width at the nut (px). */
  nutWidthPx?: number;
  /** Fret space whose region is blanked as if a hand covered it: [from, to]. */
  handFrets?: [number, number] | null;
  noise?: number;
  /** Board gray, wire gray. */
  boardGray?: number;
  wireGray?: number;
  backgroundGray?: number;
  seed?: number;
}

export interface SyntheticScene {
  frame: RgbaFrame;
  params: Required<SyntheticParams>;
  /** Frame px of wire n at the axis. */
  wireAt: (n: number) => Point;
  /** A hand prior positioned over the blanked interval. */
  hand: HandPrior | null;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderSyntheticNeck(p: SyntheticParams = {}): SyntheticScene {
  const params: Required<SyntheticParams> = {
    width: p.width ?? 960,
    height: p.height ?? 540,
    profile: p.profile ?? GUITAR_STANDARD,
    nut: p.nut ?? { x: 900, y: 150 },
    angle: p.angle ?? Math.PI - 0.35,
    B: p.B ?? 1100,
    C: p.C ?? 0.15,
    nutWidthPx: p.nutWidthPx ?? 56,
    handFrets: p.handFrets === undefined ? [5, 8] : p.handFrets,
    noise: p.noise ?? 6,
    boardGray: p.boardGray ?? 40,
    wireGray: p.wireGray ?? 190,
    backgroundGray: p.backgroundGray ?? 110,
    seed: p.seed ?? 1,
  };
  const { width, height, profile, nut, angle, B, C, nutWidthPx } = params;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const tOf = (n: number) => {
    const f = fretFraction(n);
    return (B * f) / (1 + C * f);
  };
  const nOf = (t: number) => {
    const denom = B - C * t;
    if (denom <= 0) return NaN;
    const f = t / denom;
    return f >= 1 ? NaN : -12 * Math.log2(1 - f);
  };
  const widthAt = (n: number) => (nutWidthPx * neckWidthMmAt(profile, n)) / profile.nutWidthMm;
  const rand = mulberry32(params.seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const tEnd = tOf(profile.fretCount) + 0.5 * (tOf(profile.fretCount) - tOf(profile.fretCount - 1));
  const inlay = new Set(profile.inlayFrets);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - nut.x;
      const dy = y - nut.y;
      const t = dx * dir.x + dy * dir.y;
      const s = dx * normal.x + dy * normal.y;
      let g = params.backgroundGray;
      const n = nOf(t);
      if (t >= -8 && t <= tEnd && !Number.isNaN(n)) {
        const w = widthAt(Math.max(0, n));
        if (Math.abs(s) <= w / 2) {
          g = params.boardGray;
          // Wires: nearest integer n, bright if within ~1 px of the wire.
          const ni = Math.round(n);
          const dt = Math.abs(t - tOf(ni));
          const thick = ni === 0 ? 3.5 : 1.2;
          if (dt <= thick) g = params.wireGray;
          // Inlay dots at the centre of the space.
          const space = Math.ceil(n);
          if (inlay.has(space) && space >= 1) {
            const tc = (tOf(space - 1) + tOf(space)) / 2;
            const gap = tOf(space) - tOf(space - 1);
            const r = 0.18 * gap;
            const offsets = space === 12 ? [-w * 0.2, w * 0.2] : [0];
            for (const so of offsets) {
              if (Math.hypot(t - tc, s - so) <= r) g = 200;
            }
          }
        } else if (Math.abs(s) <= w / 2 + 2) {
          g = 70; // neck edge
        }
        // Hand occlusion: blank a skin-coloured blob over the interval.
        if (params.handFrets && Math.abs(s) <= w / 2 + 30) {
          const [a, b] = params.handFrets;
          if (t >= tOf(a - 1) - 6 && t <= tOf(b) + 6) g = 150;
        }
      }
      g += (rand() - 0.5) * 2 * params.noise;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, g));
      data[i + 3] = 255;
    }
  }
  const wireAt = (n: number): Point => ({ x: nut.x + dir.x * tOf(n), y: nut.y + dir.y * tOf(n) });
  let hand: HandPrior | null = null;
  if (params.handFrets) {
    const [a, b] = params.handFrets;
    const tc = (tOf(a - 1) + tOf(b)) / 2;
    const centre = { x: nut.x + dir.x * tc + normal.x * 10, y: nut.y + dir.y * tc + normal.y * 10 };
    const mcpDist = (tOf(b) - tOf(a - 1)) * 0.75;
    const t0 = tOf(a - 1);
    const t1 = tOf(b);
    const pts: Point[] = [];
    for (let i = 0; i < 21; i++) {
      const tt = t0 + ((t1 - t0) * i) / 20;
      pts.push({ x: nut.x + dir.x * tt + normal.x * 20, y: nut.y + dir.y * tt + normal.y * 20 });
    }
    hand = { points: pts, centre, dir, mcpDist, tipDir: { x: -normal.x, y: -normal.y } };
  }
  return { frame: { data, width, height }, params, wireAt, hand };
}
