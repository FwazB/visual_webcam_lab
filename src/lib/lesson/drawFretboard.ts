// Canvas drawing of the fretboard diagram: strings, frets, inlays, lesson
// targets and a fading ring on the last played note.

import type { InstrumentProfile } from "@/lib/instrument/profile";
import { noteAt } from "@/lib/instrument/positions";

export const DIAGRAM_FRETS = 15;

export interface DiagramTarget {
  string: number;
  fret: number;
  label: string;
  color: string;
}

export interface PlayedPulse {
  string: number;
  fret: number;
  ok: boolean;
  /** performance.now() when the note was played. */
  at: number;
}

const PULSE_MS = 600;

export function drawFretboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  profile: InstrumentProfile,
  targets: DiagramTarget[],
  pulse: PlayedPulse | null,
): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 40;
  const padR = 16;
  const padT = 24;
  const padB = 22;
  const boardW = w - padL - padR;
  const boardH = h - padT - padB;
  const fretW = boardW / DIAGRAM_FRETS;
  const stringH = boardH / Math.max(1, profile.stringCount - 1);
  // Lowest string on top, as the player sees the neck when looking down.
  const yOf = (s: number) => padT + s * stringH;
  const xOf = (fret: number) => padL + (fret === 0 ? 0 : fret - 0.5) * fretW;

  ctx.fillStyle = "#1c1410";
  ctx.fillRect(padL, padT, boardW, boardH);

  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  for (const f of profile.inlayFrets) {
    if (f > DIAGRAM_FRETS) continue;
    const ys = f === 12 ? [padT + boardH / 3, padT + (2 * boardH) / 3] : [padT + boardH / 2];
    for (const y of ys) {
      ctx.beginPath();
      ctx.arc(xOf(f), y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let f = 0; f <= DIAGRAM_FRETS; f++) {
    const x = padL + f * fretW;
    ctx.lineWidth = f === 0 ? 3 : 1;
    ctx.strokeStyle = f === 0 ? "rgba(255, 255, 255, 0.9)" : "rgba(200, 200, 200, 0.35)";
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + boardH);
    ctx.stroke();
  }

  ctx.font = "bold 13px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let s = 0; s < profile.stringCount; s++) {
    const y = yOf(s);
    ctx.lineWidth = Math.max(0.6, 2 - s * 0.25);
    ctx.strokeStyle = "rgba(220, 200, 160, 0.7)";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + boardW, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(220, 220, 220, 0.85)";
    ctx.fillText(profile.stringLabels[s] ?? String(s), padL - 8, y);
  }

  ctx.fillStyle = "rgba(170, 170, 170, 0.7)";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let f = 1; f <= DIAGRAM_FRETS; f++) ctx.fillText(String(f), xOf(f), padT + boardH + 4);

  const age = pulse ? performance.now() - pulse.at : Infinity;
  if (pulse && age < PULSE_MS && pulse.fret <= DIAGRAM_FRETS) {
    const a = 1 - age / PULSE_MS;
    ctx.strokeStyle = (pulse.ok ? "rgba(102,255,153," : "rgba(255,255,255,") + a + ")";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(xOf(pulse.fret), yOf(pulse.string), 18 + (1 - a) * 10, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const t of targets) {
    if (t.fret < 0 || t.fret > DIAGRAM_FRETS) continue;
    const x = xOf(t.fret);
    const y = yOf(t.string);
    const glow = ctx.createRadialGradient(x, y, 4, x, y, 22);
    glow.addColorStop(0, t.color + "aa");
    glow.addColorStop(1, t.color + "00");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = t.color;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.label, x, y);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "9px monospace";
    ctx.fillText(noteAt(profile, t.string, t.fret), x, y - 20);
  }
}
