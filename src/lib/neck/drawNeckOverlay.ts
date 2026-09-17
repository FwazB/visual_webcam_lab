// Canvas drawing of the neck model / observation on top of the webcam view.

import type { InstrumentProfile } from "@/lib/instrument/profile";
import { axisToPixel, edgeS, fretT, neckToPixel, wireEndpoints, type CoverTransform } from "./model";
import type { NeckModel, NeckObservation, NeckTrackStatus, Point } from "./types";

export interface OverlayOptions {
  model: NeckModel | null;
  obs: NeckObservation | null;
  status: NeckTrackStatus;
  transform: CoverTransform;
  profile: InstrumentProfile;
  debug: boolean;
  /** Fingertips in frame px with their neck position label. */
  fingertips?: Array<{ name: string; p: Point; label: string | null; color: string }>;
  /** Targets to highlight on the real neck. */
  targets?: Array<{ string: number; fret: number; color: string; label?: string }>;
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawNeckOverlay(ctx: CanvasRenderingContext2D, o: OverlayOptions): void {
  const { model, obs, transform, profile } = o;
  const T = transform.toDisplay;
  if (model) {
    const alpha = Math.max(0.25, model.confidence);
    const observed = new Set(model.assignedWires.map((w) => w.n));
    // Neck band edges.
    const tEnd = fretT(model, profile.fretCount);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(0, 220, 255, ${0.6 * alpha})`;
    line(ctx, T(axisToPixel(model, 0, edgeS(model.topEdge, 0))), T(axisToPixel(model, tEnd, edgeS(model.topEdge, tEnd))));
    line(ctx, T(axisToPixel(model, 0, edgeS(model.bottomEdge, 0))), T(axisToPixel(model, tEnd, edgeS(model.bottomEdge, tEnd))));

    // String lanes.
    ctx.strokeStyle = `rgba(255,255,255,${0.18 * alpha})`;
    ctx.lineWidth = 1;
    for (let s = 0; s < profile.stringCount; s++) {
      const a = neckToPixel(model, profile, 0, s, 0.5);
      const b = neckToPixel(model, profile, profile.fretCount, s, 0.5);
      line(ctx, T(a), T(b));
      const lp = T(neckToPixel(model, profile, 1, s, 0.3));
      ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(profile.stringLabels[s] ?? String(s), lp.x, lp.y);
    }

    // Wires: observed solid, predicted dashed; nut thick.
    for (let n = 0; n <= profile.fretCount; n++) {
      const [a, b] = wireEndpoints(model, n);
      const isObs = observed.has(n);
      ctx.setLineDash(isObs ? [] : [4, 4]);
      ctx.lineWidth = n === 0 ? 3 : 1.5;
      ctx.strokeStyle = n === 0 ? `rgba(255,255,255,${0.9 * alpha})` : `rgba(80,255,120,${(isObs ? 0.9 : 0.45) * alpha})`;
      line(ctx, T(a), T(b));
      ctx.setLineDash([]);
      if (n > 0 && (n % 2 === 1 || n === 12)) {
        const p = T(a);
        ctx.fillStyle = `rgba(255,255,255,${0.75 * alpha})`;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(String(n), p.x, p.y - 3);
      }
    }

    // Targets.
    for (const t of o.targets ?? []) {
      const p = T(neckToPixel(model, profile, t.fret, t.string));
      const glow = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 16);
      glow.addColorStop(0, t.color + "cc");
      glow.addColorStop(1, t.color + "00");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      if (t.label) {
        ctx.fillStyle = t.color;
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.label, p.x, p.y);
      }
    }
  }

  // Fingertips.
  for (const f of o.fingertips ?? []) {
    const p = T(f.p);
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (f.label) {
      ctx.font = "bold 11px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(p.x + 12, p.y - 8, ctx.measureText(f.label).width + 6, 16);
      ctx.fillStyle = f.color;
      ctx.fillText(f.label, p.x + 15, p.y);
    }
  }

  if (o.debug && obs && obs.model) {
    // Raw observed wires (in the observation's own axis frame) and dots.
    const om = obs.model;
    ctx.strokeStyle = "rgba(255,0,200,0.6)";
    ctx.lineWidth = 1;
    for (const d of obs.dots) {
      if (d.response <= 0.8) continue;
      const p = T(neckToPixel(om, profile, d.space, (profile.stringCount - 1) / 2, 0.5));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (obs.handMask) {
      ctx.fillStyle = "rgba(255,60,60,0.15)";
      // Hand mask is in the strip frame; approximate using the model axis.
      const [a, b] = obs.handMask;
      const width = edgeS(om.bottomEdge, 0) - edgeS(om.topEdge, 0);
      const pa = T(axisToPixel(om, a, edgeS(om.topEdge, a)));
      const pb = T(axisToPixel(om, b, edgeS(om.topEdge, b)));
      const pc = T(axisToPixel(om, b, edgeS(om.topEdge, b) + width));
      const pd = T(axisToPixel(om, a, edgeS(om.topEdge, a) + width));
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.lineTo(pd.x, pd.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (o.debug) {
    const lines = [
      `neck: ${o.status}`,
      model ? `conf ${model.confidence.toFixed(2)}  k-conf ${model.kConfidence.toFixed(2)}  C ${model.fit.C.toFixed(2)}` : "no model",
      model ? `k-cands ${model.kCandidates.slice(0, 3).map((c) => `${c.delta >= 0 ? "+" : ""}${c.delta}:${c.score.toFixed(1)}`).join(" ")}` : "",
      obs ? `wires ${obs.wires.length}  nut ${obs.nutScore.toFixed(1)}  ${obs.timingMs.toFixed(1)}ms${obs.reason ? "  " + obs.reason : ""}` : "",
    ].filter(Boolean);
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const w = 300;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, 8, w, 14 * lines.length + 8);
    ctx.fillStyle = "#9ff";
    lines.forEach((l, i) => ctx.fillText(l, 12, 12 + i * 14));
  }
}
