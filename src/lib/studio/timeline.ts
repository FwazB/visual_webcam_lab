// Studio timeline canvas: ruler, track lanes, clips with waveforms, the
// recording region and the playhead, plus pointer hit-testing.

import { PEAKS_PER_SECOND } from "./audio";
import type { Project } from "./project";

export const RULER_H = 28;
export const ROW_H = 72;
const EDGE_PX = 8;
const CLIP_LABEL_H = 16;

export interface TimelineView {
  /** Timeline time at the left edge (s). */
  scrollX: number;
  pxPerSec: number;
  width: number;
  height: number;
}

export function xAt(view: TimelineView, t: number): number {
  return (t - view.scrollX) * view.pxPerSec;
}

export function timeAt(view: TimelineView, x: number): number {
  return view.scrollX + x / view.pxPerSec;
}

/** Track row under a y coordinate (may be out of range). */
export function rowAt(y: number): number {
  return Math.floor((y - RULER_H) / ROW_H);
}

export type Hit =
  | { kind: "ruler"; t: number }
  | { kind: "clip"; clipId: string; edge: "start" | "end" | null; t: number }
  | { kind: "lane"; row: number; t: number }
  | { kind: "empty"; t: number };

export function hitTest(project: Project, view: TimelineView, x: number, y: number): Hit {
  const t = timeAt(view, x);
  if (y < RULER_H) return { kind: "ruler", t };
  const row = rowAt(y);
  const track = project.tracks[row];
  if (!track) return { kind: "empty", t };
  // Later clips draw on top, so they win.
  for (let i = project.clips.length - 1; i >= 0; i--) {
    const clip = project.clips[i];
    if (clip.trackId !== track.id) continue;
    const x0 = xAt(view, clip.start);
    const x1 = xAt(view, clip.start + clip.duration);
    if (x < x0 || x > x1) continue;
    const edgeW = Math.min(EDGE_PX, (x1 - x0) / 3);
    const edge = x - x0 <= edgeW ? "start" : x1 - x <= edgeW ? "end" : null;
    return { kind: "clip", clipId: clip.id, edge, t };
  }
  return { kind: "lane", row, t };
}

export interface TimelineScene {
  project: Project;
  view: TimelineView;
  peaks: Map<string, Float32Array>;
  selectedClipId: string | null;
  armedTrackId: string | null;
  playhead: number;
  /** Region being recorded, drawn on its track. */
  recording: { trackId: string; start: number } | null;
}

export function drawTimeline(ctx: CanvasRenderingContext2D, scene: TimelineScene): void {
  const { project, view, peaks } = scene;
  const { width, height } = view;
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);

  project.tracks.forEach((track, row) => {
    const y = RULER_H + row * ROW_H;
    ctx.fillStyle = track.id === scene.armedTrackId ? "rgba(239,68,68,0.07)" : row % 2 ? "#0c0c0f" : "#111114";
    ctx.fillRect(0, y, width, ROW_H);
  });

  // Beat and bar grid.
  const spb = 60 / project.bpm;
  const beatPx = spb * view.pxPerSec;
  const firstBeat = Math.floor(view.scrollX / spb);
  const lastBeat = Math.ceil(timeAt(view, width) / spb);
  ctx.font = "10px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, width, RULER_H);
  for (let b = Math.max(0, firstBeat); b <= lastBeat; b++) {
    const x = Math.round(xAt(view, b * spb)) + 0.5;
    const isBar = b % project.beatsPerBar === 0;
    if (!isBar && beatPx < 8) continue;
    const bar = b / project.beatsPerBar;
    // Keep bar labels at least ~40 px apart.
    const labelEvery = Math.max(1, Math.ceil(40 / (beatPx * project.beatsPerBar)));
    ctx.strokeStyle = isBar ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(x, isBar ? 0 : RULER_H - 6);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (isBar && bar % labelEvery === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText(String(bar + 1), x + 4, RULER_H / 2);
    }
  }

  // Clips.
  for (const clip of project.clips) {
    const row = project.tracks.findIndex((t) => t.id === clip.trackId);
    if (row < 0) continue;
    const track = project.tracks[row];
    const x0 = xAt(view, clip.start);
    const x1 = xAt(view, clip.start + clip.duration);
    if (x1 < 0 || x0 > width) continue;
    const y0 = RULER_H + row * ROW_H + 3;
    const h = ROW_H - 6;
    ctx.fillStyle = track.color + "33";
    ctx.fillRect(x0, y0, x1 - x0, h);
    ctx.fillStyle = track.color + "88";
    ctx.fillRect(x0, y0, x1 - x0, CLIP_LABEL_H);

    const clipPeaks = peaks.get(clip.bufferId);
    if (clipPeaks) {
      const mid = y0 + CLIP_LABEL_H + (h - CLIP_LABEL_H) / 2;
      const amp = (h - CLIP_LABEL_H) / 2 - 2;
      const bucketsPerPx = PEAKS_PER_SECOND / view.pxPerSec;
      ctx.fillStyle = track.color;
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(width, x1); px++) {
        const bufferT = clip.offset + (timeAt(view, px) - clip.start);
        const from = Math.floor(bufferT * PEAKS_PER_SECOND);
        const to = Math.max(from + 1, Math.floor(from + bucketsPerPx));
        let peak = 0;
        for (let b = from; b < to && b < clipPeaks.length; b++) if (b >= 0 && clipPeaks[b] > peak) peak = clipPeaks[b];
        const bar = Math.max(0.5, Math.min(1, peak) * amp);
        ctx.fillRect(px, mid - bar, 1, bar * 2);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, CLIP_LABEL_H);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillText(clip.name, Math.max(x0, 0) + 4, y0 + CLIP_LABEL_H / 2);
    ctx.restore();

    const selected = clip.id === scene.selectedClipId;
    ctx.strokeStyle = selected ? "#ffffff" : track.color;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, h - 1);
  }

  // Take being recorded.
  const rec = scene.recording;
  if (rec && scene.playhead > rec.start) {
    const row = project.tracks.findIndex((t) => t.id === rec.trackId);
    if (row >= 0) {
      const x0 = xAt(view, rec.start);
      const x1 = xAt(view, scene.playhead);
      ctx.fillStyle = "rgba(239,68,68,0.3)";
      ctx.fillRect(x0, RULER_H + row * ROW_H + 3, x1 - x0, ROW_H - 6);
    }
  }

  const px = Math.round(xAt(view, Math.max(0, scene.playhead))) + 0.5;
  if (px >= 0 && px <= width) {
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.fill();
  }
}
