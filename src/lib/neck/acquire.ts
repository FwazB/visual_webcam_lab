// Low-resolution image proposals for acquiring a visible neck without a hand.
// Parallel gradient-supported edges only propose a strip; the fret detector
// must still confirm multiple wires and their shrinking spacing.

import { sampleGray } from "./image";
import type { Point, RgbaFrame, WireDetection } from "./types";

export interface NeckSeed {
  origin: Point;
  angle: number;
  s0: number;
  nS: number;
  minWidth: number;
  score: number;
}

/** Cheap shrinking-gap check before attempting the more expensive fret-law fit. */
export function findFretRun(wires: WireDetection[]): { score: number; wires: WireDetection[] } {
  if (wires.length < 5 || wires.length > 28) return { score: 0, wires: [] };
  let best = 0;
  let bestWires: WireDetection[] = [];
  for (const sign of [1, -1]) {
    const ordered = wires.slice().sort((a, b) => sign * (a.t - b.t));
    const positions = ordered.map((wire) => sign * wire.t);
    for (let i = 0; i < positions.length - 4; i++) {
      for (let j = i + 1; j < Math.min(i + 4, positions.length - 3); j++) {
        const firstGap = positions[j] - positions[i];
        if (firstGap < 10) continue;
        for (let k = j + 1; k < Math.min(j + 4, positions.length - 2); k++) {
          let gap = positions[k] - positions[j];
          let ratio = gap / firstGap;
          if (ratio < 0.80 || ratio > 0.995) continue;
          let last = k, count = 3, error = 0;
          const matched = [ordered[i], ordered[j], ordered[k]];
          while (last < positions.length - 1) {
            const expected = positions[last] + gap * ratio;
            let next = -1, residual = Infinity;
            for (let n = last + 1; n < Math.min(last + 4, positions.length); n++) {
              const delta = Math.abs(positions[n] - expected);
              if (delta < residual) { next = n; residual = delta; }
            }
            if (next < 0 || residual > Math.max(3, gap * 0.20)) break;
            const actual = positions[next] - positions[last];
            ratio = 0.5 * ratio + 0.5 * actual / gap;
            if (ratio < 0.75 || ratio > 1.05) break;
            error += residual / gap;
            gap = actual;
            last = next;
            count++;
            matched.push(ordered[next]);
          }
          if (count >= 5 && firstGap / gap > 1.12 && count - error * 2 > best) {
            best = count - error * 2;
            bestWires = matched.slice().sort((a, b) => a.t - b.t);
          }
        }
      }
    }
  }
  return { score: best, wires: bestWires };
}

export function findNeckSeeds(frame: RgbaFrame): NeckSeed[] {
  const scale = Math.max(1, frame.width / 320, frame.height / 240);
  const width = Math.floor(frame.width / scale);
  const height = Math.floor(frame.height / scale);
  if (width < 40 || height < 40) return [];
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = sampleGray(frame, x * scale, y * scale);
  }

  const angles = 72;
  const radius = Math.ceil(Math.hypot(width, height));
  const bins = radius + 1; // Rho bins span [-radius, radius] at two-pixel spacing.
  const mass = new Float32Array(angles * bins);
  const lo = new Float32Array(mass.length).fill(Infinity);
  const hi = new Float32Array(mass.length).fill(-Infinity);
  const cos = Array.from({ length: angles }, (_, i) => Math.cos(i * Math.PI / angles));
  const sin = Array.from({ length: angles }, (_, i) => Math.sin(i * Math.PI / angles));
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1];
      const gy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1];
      const strength = Math.hypot(gx, gy);
      if (strength < 32) continue;
      const angle = ((Math.atan2(gy, gx) + 1.5 * Math.PI) % Math.PI);
      const nearest = Math.round(angle * angles / Math.PI);
      for (let d = -1; d <= 1; d++) {
        const a = (nearest + d + angles) % angles;
        const rho = -x * sin[a] + y * cos[a];
        const r = Math.round((rho + radius) / 2);
        const index = a * bins + r;
        const along = x * cos[a] + y * sin[a];
        mass[index] += Math.min(160, strength);
        lo[index] = Math.min(lo[index], along);
        hi[index] = Math.max(hi[index], along);
      }
    }
  }

  const proposals: NeckSeed[] = [];
  for (let a = 0; a < angles; a++) {
    const peaks: number[] = [];
    const base = a * bins;
    for (let r = 2; r < bins - 2; r++) {
      const i = base + r;
      if (mass[i] < 1600 || hi[i] - lo[i] < 60) continue;
      if (mass[i] > mass[i - 1] && mass[i] >= mass[i + 1]
        && mass[i] > mass[i - 2] && mass[i] >= mass[i + 2]) peaks.push(r);
    }
    for (let p = 0; p < peaks.length; p++) {
      for (let q = p + 1; q < peaks.length; q++) {
        const gap = 2 * (peaks[q] - peaks[p]);
        if (gap < 6 || gap > 44) continue;
        const first = base + peaks[p], second = base + peaks[q];
        const start = Math.max(lo[first], lo[second]);
        const end = Math.min(hi[first], hi[second]);
        if (end - start < Math.max(60, 3.5 * gap)) continue;
        const rho = peaks[p] + peaks[q] - radius;
        const along = (start + end) / 2;
        const half = Math.max(18 * scale, gap * scale * 0.7 + 8);
        proposals.push({
          origin: { x: (cos[a] * along - sin[a] * rho) * scale, y: (sin[a] * along + cos[a] * rho) * scale },
          angle: a * Math.PI / angles,
          s0: -half,
          nS: Math.round(half * 2),
          minWidth: 8 * scale,
          score: Math.sqrt(mass[first] * mass[second]) * Math.min(1, (end - start) / 140),
        });
      }
    }
  }
  proposals.sort((a, b) => b.score - a.score);
  const selected: NeckSeed[] = [];
  for (const proposal of proposals) {
    if (selected.filter((other) => {
      const delta = Math.abs(proposal.angle - other.angle);
      return Math.min(delta, Math.PI - delta) < Math.PI / 18;
    }).length >= 2) continue;
    const duplicate = selected.some((other) => {
      const delta = Math.abs(proposal.angle - other.angle);
      const angleDistance = Math.min(delta, Math.PI - delta);
      const across = Math.abs(-(proposal.origin.x - other.origin.x) * Math.sin(other.angle)
        + (proposal.origin.y - other.origin.y) * Math.cos(other.angle));
      return angleDistance < Math.PI / 18 && across < 6 * scale;
    });
    if (!duplicate) selected.push(proposal);
    if (selected.length === 8) break;
  }
  return selected;
}
