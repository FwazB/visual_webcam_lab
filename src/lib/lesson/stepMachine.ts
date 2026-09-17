// Lesson step scoring: audio-first hits with vision hints. A single-target
// step goes idle → approach → ready → hit; wrong pitches flash red. Sequence
// steps advance through their targets; shape-vision steps keep the old
// all-at-once visual match for chords.

import type { NoteEvent } from "@/lib/audio/pitchTypes";
import type { FingerName } from "@/lib/neck/fretHand";
import type { FusionOutput, NeckCoord } from "@/lib/instrument/fusion";
import type { MatchState } from "@/lib/bass/shapes";
import { matchShape } from "@/lib/bass/shapes";

export interface LessonTarget {
  s: number;
  f: number;
  midi: number;
  finger?: FingerName;
  role?: string;
}

export type LessonMode = "single" | "sequence" | "shape-vision";

export interface LessonStep {
  targets: LessonTarget[];
  mode: LessonMode;
}

export type StepPhase = "idle" | "approach" | "ready" | "hit" | "wrong";

export interface StepView {
  phase: StepPhase;
  light: MatchState;
  /** Index of the current target (sequence/single), or −1 for shape-vision. */
  targetIndex: number;
  coveredIdx: Set<number>;
  hint: string | null;
  /** Completed steps counter for UI. */
  completed: number;
}

export interface ScoreContext {
  t: number;
  expectedT?: number;
  windowMs?: number;
}

export interface StepResult {
  hit: boolean;
  pitchDeltaCents: number;
  positionMatch: boolean;
  timingDeltaMs?: number;
}

export interface FingertipNeck {
  finger: FingerName;
  neck: NeckCoord | null;
}

export interface StepMachineOptions {
  requirePosition?: boolean;
  pitchToleranceCents?: number;
}

export class StepMachine {
  private step: LessonStep = { targets: [], mode: "single" };
  private phase: StepPhase = "idle";
  private targetIndex = 0;
  private covered = new Set<number>();
  private hint: string | null = null;
  private completed = 0;
  private phaseSince = 0;
  private leaveFrames = 0;
  private wrongUntil = 0;
  private hitAt = 0;
  private opts: Required<StepMachineOptions>;
  private onAdvance: (() => void) | null = null;

  constructor(opts: StepMachineOptions = {}) {
    this.opts = { requirePosition: opts.requirePosition ?? false, pitchToleranceCents: opts.pitchToleranceCents ?? 35 };
  }

  setStep(step: LessonStep): void {
    this.step = step;
    this.phase = "idle";
    this.targetIndex = 0;
    this.covered = new Set();
    this.hint = null;
  }

  setOnAdvance(cb: (() => void) | null): void {
    this.onAdvance = cb;
  }

  get currentTarget(): LessonTarget | null {
    if (this.step.mode === "shape-vision") return null;
    return this.step.targets[this.targetIndex] ?? null;
  }

  get view(): StepView {
    return {
      phase: this.phase,
      light: this.lightFor(this.phase),
      targetIndex: this.step.mode === "shape-vision" ? -1 : this.targetIndex,
      coveredIdx: this.covered,
      hint: this.hint,
      completed: this.completed,
    };
  }

  private lightFor(phase: StepPhase): MatchState {
    switch (phase) {
      case "hit":
        return "green";
      case "approach":
      case "ready":
        return "yellow";
      case "wrong":
        return "red";
      default:
        return "red";
    }
  }

  onFrame(tips: FingertipNeck[], fusion: FusionOutput | null, t: number): StepView {
    if (this.phase === "wrong" && t >= this.wrongUntil) this.phase = "idle";
    if (this.phase === "hit") {
      if (t - this.hitAt >= 0.15) this.advance();
      return this.view;
    }
    if (this.step.mode === "shape-vision") {
      const fingers = tips
        .filter((x) => x.neck)
        .map((x) => ({ string: x.neck!.v, fret: x.neck!.u + 0.3 }));
      const { state, coveredIdx } = matchShape(
        this.step.targets.map((tg) => ({ string: tg.s, fret: tg.f })),
        fingers,
      );
      this.covered = coveredIdx;
      this.phase = state === "green" ? "hit" : state === "yellow" ? "approach" : "idle";
      if (this.phase === "hit") this.hitAt = t;
      return this.view;
    }
    const target = this.currentTarget;
    if (!target) return this.view;
    if (this.phase === "wrong") return this.view;
    let nearest: { du: number; dv: number; finger: FingerName } | null = null;
    for (const tp of tips) {
      if (!tp.neck) continue;
      const du = Math.abs(tp.neck.u - (target.f - 0.3));
      const dv = Math.abs(tp.neck.v - target.s);
      if (!nearest || du + dv < nearest.du + nearest.dv) nearest = { du, dv, finger: tp.finger };
    }
    const pressing = fusion?.pressing ?? null;
    if (nearest && nearest.du <= 0.5 && nearest.dv <= 0.4 && pressing?.[nearest.finger] === "likely") {
      this.phase = "ready";
      this.leaveFrames = 0;
    } else if (nearest && nearest.du <= 1.0 && nearest.dv <= 0.6) {
      this.phase = this.phase === "ready" ? "ready" : "approach";
      this.leaveFrames = 0;
    } else if (nearest && nearest.du <= 1.5 && nearest.dv <= 1.0) {
      this.leaveFrames = 0;
    } else if (this.phase === "approach" || this.phase === "ready") {
      this.leaveFrames++;
      if (this.leaveFrames >= 10) this.phase = "idle";
    }
    this.covered = new Set();
    return this.view;
  }

  onNote(evt: NoteEvent, fusion: FusionOutput | null, ctx?: ScoreContext): StepResult {
    const target = this.currentTarget;
    const t = ctx?.t ?? evt.t;
    if (!target) return { hit: false, pitchDeltaCents: 0, positionMatch: false };
    const deltaCents = (evt.midiFloat - target.midi) * 100;
    const pitchOk = Math.abs(deltaCents) <= this.opts.pitchToleranceCents;
    const lc = fusion?.lastConfirmed ?? null;
    const positionMatch = !!lc && lc.noteId === evt.id && lc.s === target.s && lc.f === target.f && !lc.unmatched;
    const timingDeltaMs = ctx?.expectedT !== undefined ? (evt.t - ctx.expectedT) * 1000 : undefined;
    const timingOk = timingDeltaMs === undefined || Math.abs(timingDeltaMs) <= (ctx?.windowMs ?? 100);
    if (pitchOk && timingOk && (!this.opts.requirePosition || positionMatch)) {
      this.phase = "hit";
      this.hitAt = t;
      this.hint = positionMatch || !lc || lc.unmatched ? null : "right note, other position";
      return { hit: true, pitchDeltaCents: deltaCents, positionMatch, timingDeltaMs };
    }
    if (pitchOk && this.opts.requirePosition) {
      this.hint = "right note, wrong position";
      this.phase = "approach";
      return { hit: false, pitchDeltaCents: deltaCents, positionMatch, timingDeltaMs };
    }
    this.phase = "wrong";
    this.wrongUntil = t + 0.4;
    this.hint = null;
    return { hit: false, pitchDeltaCents: deltaCents, positionMatch, timingDeltaMs };
  }

  private advance(): void {
    this.completed++;
    if (this.step.mode === "sequence" && this.targetIndex < this.step.targets.length - 1) {
      this.targetIndex++;
    } else {
      this.targetIndex = 0;
      this.onAdvance?.();
    }
    this.phase = "idle";
    this.hint = null;
  }
}
