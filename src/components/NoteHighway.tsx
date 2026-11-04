"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import type { HighwayGame } from "@/lib/lesson/noteHighway";
import styles from "./NoteHighway.module.css";

interface Props {
  profile: InstrumentProfile;
  gameRef: RefObject<HighwayGame | null>;
  beatsRef: RefObject<number>;
  playing: boolean;
  inputReady: boolean;
  preview: boolean;
}

const COLORS = ["#62e1e8", "#ffb45d", "#f57b9c", "#b8a1ef", "#7cb5ff", "#76e3a5"];
const APPROACH_BEATS = 6;
const CHALK = "#f1ede4";
const MINT = "#76e3a5";
const CORAL = "#ff8b80";
type FeedbackKind = "perfect" | "good" | "wrong" | "miss";
interface Readout {
  score: number;
  streak: number;
  accuracy: number | null;
  upcoming: string;
  countdown: number | null;
  feedback: FeedbackKind | null;
}
const INITIAL: Readout = { score: 0, streak: 0, accuracy: null, upcoming: "Waiting for the note chart.", countdown: null, feedback: null };
const FEEDBACK = { perfect: "Perfect!", good: "Good timing", wrong: "Try the next note", miss: "Keep going" };

function stringName(profile: InstrumentProfile, string: number): string {
  if (profile.stringCount === 6 && string === 0) return "low E";
  if (profile.stringCount === 6 && string === 5) return "high E";
  return profile.stringLabels[string] ?? String(profile.stringCount - string);
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const radius = Math.min(9, height / 3);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Presentation only: the shared audio clock and game own every judgement. */
export default function NoteHighway({ profile, gameRef, beatsRef, playing, inputReady, preview }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heldBeatRef = useRef<number | null>(null);
  const displayedGameRef = useRef<HighwayGame | null>(null);
  const [readout, setReadout] = useState<Readout>(INITIAL);
  const stringCount = Math.max(1, Math.min(6, profile.stringCount));

  useEffect(() => {
    let raf = 0, lastDraw = -Infinity, lastReadout = -Infinity;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motion.matches;
    const changeMotion = () => { reducedMotion = motion.matches; };
    motion.addEventListener("change", changeMotion);
    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      const game = gameRef.current;
      if (game !== displayedGameRef.current || heldBeatRef.current === null) {
        displayedGameRef.current = game;
        heldBeatRef.current = Number.isFinite(beatsRef.current) ? beatsRef.current : 0;
      }
      if (playing && Number.isFinite(beatsRef.current)) heldBeatRef.current = beatsRef.current;
      const beat = heldBeatRef.current;
      const notes = game?.notesBetween(beat - 0.75, beat + APPROACH_BEATS).slice(0, 128).filter(note =>
        Number.isFinite(note.beat) && Number.isInteger(note.string) && note.string >= 0 && note.string < stringCount
        && Number.isInteger(note.fret) && note.fret >= 0 && note.fret <= profile.fretCount) ?? [];
      const summary = game?.summary();
      const feedback = !preview && inputReady && playing ? summary?.feedback ?? null : null;
      const feedbackAge = feedback ? beat - feedback.beat : Infinity;
      const visibleFeedback = feedback && feedbackAge >= 0 && feedbackAge < 1 ? feedback.kind : null;
      if (now - lastReadout >= 125) {
        lastReadout = now;
        const upcoming = notes.find(note => note.beat >= beat - 0.12 && (preview || note.state === "pending"));
        const next: Readout = {
          score: preview ? 0 : summary?.score ?? 0,
          streak: preview ? 0 : summary?.streak ?? 0,
          accuracy: !preview && summary && summary.hits + summary.misses + summary.wrong > 0 ? summary.accuracy : null,
          upcoming: upcoming ? `Next: ${upcoming.fret === 0 ? "open" : `fret ${upcoming.fret}`} on the ${stringName(profile, upcoming.string)} string.`
            : game ? "The next phrase is on its way." : "Waiting for the note chart.",
          countdown: playing && beat < 0 ? Math.min(4, Math.ceil(-beat)) : null,
          feedback: visibleFeedback,
        };
        setReadout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      }
      const surface = surfaceRef.current, canvas = canvasRef.current;
      if (!surface || !canvas) return;
      const width = Math.max(1, surface.clientWidth), height = Math.max(1, surface.clientHeight);
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const horizon = height * 0.08, hitY = height * 0.82;
      const spread = (depth: number) => width * (0.31 + depth * 0.63);
      const laneX = (lane: number, depth: number) => width / 2 + ((lane + 0.5) / stringCount - 0.5) * spread(depth);
      const edgeX = (edge: number, depth: number) => width / 2 + (edge / stringCount - 0.5) * spread(depth);
      const depthAt = (distance: number) => Math.pow(Math.max(0, 1 - distance / APPROACH_BEATS), 1.45);
      const yAt = (depth: number) => horizon + (hitY - horizon) * depth;
      for (let lane = 0; lane < stringCount; lane++) {
        ctx.beginPath();
        ctx.moveTo(edgeX(lane, 0), horizon); ctx.lineTo(edgeX(lane + 1, 0), horizon);
        ctx.lineTo(edgeX(lane + 1, 1.12), yAt(1.12)); ctx.lineTo(edgeX(lane, 1.12), yAt(1.12)); ctx.closePath();
        ctx.fillStyle = lane % 2 ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.045)";
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(laneX(lane, 0), horizon); ctx.lineTo(laneX(lane, 1.12), yAt(1.12));
        ctx.strokeStyle = COLORS[lane]; ctx.globalAlpha = 0.42; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
      }
      for (let lineBeat = Math.ceil(beat); lineBeat <= beat + APPROACH_BEATS; lineBeat++) {
        const depth = depthAt(lineBeat - beat), y = yAt(depth);
        ctx.beginPath(); ctx.moveTo(edgeX(0, depth), y); ctx.lineTo(edgeX(stringCount, depth), y);
        ctx.strokeStyle = lineBeat % 4 === 0 ? "rgba(241,237,228,0.24)" : "rgba(241,237,228,0.075)";
        ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(edgeX(0, 1), hitY); ctx.lineTo(edgeX(stringCount, 1), hitY);
      ctx.strokeStyle = visibleFeedback ? visibleFeedback === "perfect" || visibleFeedback === "good" ? MINT : CORAL : CHALK;
      ctx.lineWidth = 3;
      if (!reducedMotion && visibleFeedback) { ctx.shadowBlur = 14 * (1 - Math.min(1, feedbackAge)); ctx.shadowColor = ctx.strokeStyle; }
      ctx.stroke(); ctx.shadowBlur = 0;
      const fontFamily = getComputedStyle(canvas).fontFamily;
      // Farthest first: nearer fret numerals stay readable when notes overlap.
      for (const note of [...notes].sort((a, b) => b.beat - a.beat)) {
        const state = preview ? "pending" : note.state;
        if (state === "perfect" || state === "good") continue;
        const distance = note.beat - beat;
        if (distance > APPROACH_BEATS || distance < -0.65) continue;
        const depth = depthAt(distance), x = laneX(note.string, depth), y = yAt(depth);
        const noteWidth = Math.min(62, spread(depth) / stringCount * 0.77);
        const noteHeight = Math.max(18, Math.min(44, 18 + depth * 25));
        const missed = state === "miss";
        ctx.globalAlpha = missed ? 0.4 : 1;
        pill(ctx, x - noteWidth / 2, y - noteHeight / 2 + 4, noteWidth, noteHeight);
        ctx.fillStyle = "#080b13"; ctx.fill();
        pill(ctx, x - noteWidth / 2, y - noteHeight / 2, noteWidth, noteHeight);
        ctx.fillStyle = missed ? CORAL : COLORS[note.string]; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `750 ${Math.round(Math.max(12, Math.min(29, noteHeight * 0.64)))}px ${fontFamily}`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#101524";
        ctx.fillText(String(note.fret), x, y + 1);
        ctx.globalAlpha = 1;
      }
      if (!reducedMotion && visibleFeedback && (visibleFeedback === "perfect" || visibleFeedback === "good") && feedbackAge < 0.5) {
        const hit = notes.find(note => note.id === feedback?.noteId);
        if (hit) {
          ctx.beginPath(); ctx.arc(laneX(hit.string, 1), hitY, 18 + feedbackAge * 42, 0, Math.PI * 2);
          ctx.strokeStyle = MINT; ctx.lineWidth = 2; ctx.globalAlpha = 1 - feedbackAge * 2; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); motion.removeEventListener("change", changeMotion); };
  }, [profile, stringCount, gameRef, beatsRef, playing, inputReady, preview]);

  return (
    <section className={styles.highway} aria-label={`${profile.name} note highway`}>
      <div className={styles.scoreboard}>
        <div className={styles.score}><span>Score</span><strong>{preview ? "—" : readout.score.toLocaleString()}</strong></div>
        <div className={styles.stat}><span>Streak</span><strong>{preview ? "—" : readout.streak}<small>{preview ? "" : "×"}</small></strong></div>
        <div className={styles.stat}><span>Accuracy</span><strong>{preview || readout.accuracy === null ? "—" : `${Math.round(readout.accuracy)}%`}</strong></div>
        <span className={styles.mode}>{preview ? "Silent preview · scoring off" : inputReady ? "Live instrument" : "Connect an input to score"}</span>
      </div>
      <div className={styles.playfield} ref={surfaceRef}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <div className={styles.cue} aria-live="polite" aria-atomic="true">
          {playing && readout.countdown !== null ? <><span>Get ready</span><strong className={styles.countdown}>{readout.countdown}</strong></>
            : !playing ? <><strong className={styles.idle}>Your strings. Your timing.</strong><span>{preview ? "Press Preview track to watch the phrase." : "Play each fret as it reaches the line."}</span></>
              : !preview && inputReady && readout.feedback && <strong className={styles.feedback} data-kind={readout.feedback}>{FEEDBACK[readout.feedback]}</strong>}
        </div>
        <div className={styles.stringLabels} style={{ gridTemplateColumns: `repeat(${stringCount}, 1fr)` }}>
          {profile.stringLabels.slice(0, stringCount).map((label, string) => <span key={string} style={{ color: COLORS[string] }}
            aria-label={`String ${profile.stringCount - string}, ${stringName(profile, string)}`}><strong>{label}</strong><small>{profile.stringCount - string}</small></span>)}
        </div>
      </div>
      <div className={styles.caption}>
        <p className={styles.next}>{readout.upcoming}</p>
        <p>Play at the line. Numbers are frets. Lanes are strings. <span>0 = open.</span></p>
      </div>
    </section>
  );
}
