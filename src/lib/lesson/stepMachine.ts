// Lesson step scoring from audio alone. A step waits for its current target
// pitch: the right note turns it green and advances, a wrong note flashes red.
// Sequence steps walk through their targets in order.

import type { NoteEvent } from "@/lib/audio/pitchTypes";
import type { MatchState } from "@/lib/lesson/shapes";

interface LessonStep {
  /** Target pitches in playing order. */
  targets: Array<{ midi: number }>;
  mode: "single" | "sequence";
}

type StepPhase = "idle" | "hit" | "wrong";

export interface StepView {
  phase: StepPhase;
  light: MatchState;
  /** Index of the current target. */
  targetIndex: number;
  /** Completed steps counter for UI. */
  completed: number;
}

const PITCH_TOLERANCE_CENTS = 35;
/** Seconds a hit stays green before the step advances. */
const HIT_HOLD = 0.15;
/** Seconds a wrong note stays red. */
const WRONG_HOLD = 0.4;

const LIGHTS: Record<StepPhase, MatchState> = { idle: "yellow", hit: "green", wrong: "red" };

export class StepMachine {
  private step: LessonStep = { targets: [], mode: "single" };
  private phase: StepPhase = "idle";
  private targetIndex = 0;
  private completed = 0;
  private until = 0;
  private onAdvance: (() => void) | null = null;

  setStep(step: LessonStep): void {
    this.step = step;
    this.phase = "idle";
    this.targetIndex = 0;
  }

  setOnAdvance(cb: (() => void) | null): void {
    this.onAdvance = cb;
  }

  get view(): StepView {
    return {
      phase: this.phase,
      light: LIGHTS[this.phase],
      targetIndex: this.targetIndex,
      completed: this.completed,
    };
  }

  /** Advance timers; `t` is in seconds on the same clock as note events. */
  onFrame(t: number): StepView {
    if (this.phase === "wrong" && t >= this.until) this.phase = "idle";
    if (this.phase === "hit" && t >= this.until) this.advance();
    return this.view;
  }

  /** Score a note against the current target. Returns whether it was a hit. */
  onNote(evt: NoteEvent): boolean {
    const target = this.step.targets[this.targetIndex];
    if (!target || this.phase === "hit") return false;
    const hit = Math.abs(evt.midiFloat - target.midi) * 100 <= PITCH_TOLERANCE_CENTS;
    this.phase = hit ? "hit" : "wrong";
    this.until = evt.t + (hit ? HIT_HOLD : WRONG_HOLD);
    return hit;
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
  }
}
