// Segments worklet frames and onsets into discrete NoteEvent / NoteOff
// events: attack → sustain with a silence gate, pitch-loss timeout, legato
// (hammer-on / pull-off / slide) detection, and an octave-glitch filter.

import { hzToMidi } from "@/lib/instrument/pitch";
import type { NoteEvent, NoteOff, PitchFrame, WorkletMessage } from "./pitchTypes";

export interface NoteTrackerOptions {
  gateDb: number;
  clarityThreshold: number;
  hopMs: number;
}

type State = "idle" | "attack" | "sustain";

export interface NoteTrackerOutput {
  frame?: PitchFrame;
  noteOn?: NoteEvent;
  noteOff?: NoteOff;
}

export class NoteTracker {
  private state: State = "idle";
  private opts: NoteTrackerOptions;
  private nextId = 1;
  private tOnset = 0;
  private onsetStrength = 0;
  private attackFrames: PitchFrame[] = [];
  private note: NoteEvent | null = null;
  private silentSince: number | null = null;
  private unvoicedHops = 0;
  private divergentHops = 0;
  private divergentSince = 0;
  private divergentMidi = 0;
  private octaveHops = 0;
  private lastFrame: PitchFrame | null = null;
  /** Maps AudioContext seconds to performance.now() ms. */
  audioToPerf: (t: number) => number = (t) => t * 1000;

  constructor(opts: NoteTrackerOptions) {
    this.opts = opts;
  }

  setOptions(opts: Partial<NoteTrackerOptions>): void {
    Object.assign(this.opts, opts);
  }

  get activeNote(): NoteEvent | null {
    return this.note;
  }

  get latestFrame(): PitchFrame | null {
    return this.lastFrame;
  }

  reset(): void {
    this.state = "idle";
    this.note = null;
    this.attackFrames = [];
    this.silentSince = null;
    this.unvoicedHops = 0;
    this.divergentHops = 0;
    this.octaveHops = 0;
  }

  handle(msg: WorkletMessage): NoteTrackerOutput {
    if (msg.type === "onset") return this.onOnset(msg.t, msg.strength);
    return this.onFrame(msg);
  }

  private onOnset(t: number, strength: number): NoteTrackerOutput {
    const out: NoteTrackerOutput = {};
    if (this.state === "sustain" && this.note) {
      out.noteOff = { id: this.note.id, t };
      this.note = null;
    }
    this.state = "attack";
    this.tOnset = t;
    this.onsetStrength = strength;
    this.attackFrames = [];
    this.silentSince = null;
    this.unvoicedHops = 0;
    this.divergentHops = 0;
    this.octaveHops = 0;
    return out;
  }

  private onFrame(msg: Extract<WorkletMessage, { type: "frame" }>): NoteTrackerOutput {
    const est = hzToMidi(msg.hz);
    const frame: PitchFrame = {
      t: msg.t,
      hz: msg.hz,
      midiFloat: msg.hz > 0 ? est.midiFloat : NaN,
      midi: msg.hz > 0 ? est.midi : -1,
      cents: msg.hz > 0 ? est.cents : 0,
      clarity: msg.clarity,
      rms: msg.rms,
      db: msg.db,
    };
    this.lastFrame = frame;
    const out: NoteTrackerOutput = { frame };
    const voiced = msg.hz > 0 && msg.clarity >= this.opts.clarityThreshold;

    if (this.state === "attack") {
      if (voiced) this.attackFrames.push(frame);
      const elapsedMs = (msg.t - this.tOnset) * 1000;
      if (this.attackFrames.length >= 3 || (elapsedMs >= 90 && this.attackFrames.length >= 1)) {
        const note = this.emitNote(this.tOnset, "pluck", this.onsetStrength);
        out.noteOn = note;
        this.state = "sustain";
      } else if (elapsedMs >= 120) {
        this.state = "idle";
      }
      return out;
    }

    if (this.state === "sustain" && this.note) {
      const note = this.note;
      // Silence gate with hysteresis.
      if (msg.db < this.opts.gateDb - 10) {
        this.silentSince ??= msg.t;
        if ((msg.t - this.silentSince) * 1000 >= 80) {
          out.noteOff = { id: note.id, t: this.silentSince };
          this.note = null;
          this.state = "idle";
          return out;
        }
      } else {
        this.silentSince = null;
      }
      // Pitch lost (muted string).
      if (!voiced) {
        this.unvoicedHops++;
        if (this.unvoicedHops >= 5) {
          out.noteOff = { id: note.id, t: msg.t };
          this.note = null;
          this.state = "idle";
        }
        return out;
      }
      this.unvoicedHops = 0;
      const diff = frame.midiFloat - note.midiFloat;
      const absDiff = Math.abs(diff);
      // Octave glitch: ignore unless persistent.
      if (Math.abs(absDiff - 12) <= 1) {
        this.octaveHops++;
        if (this.octaveHops < 4) return out;
      } else {
        this.octaveHops = 0;
      }
      if (absDiff >= 0.7) {
        if (this.divergentHops === 0 || Math.abs(frame.midiFloat - this.divergentMidi) > 0.7) {
          this.divergentHops = 1;
          this.divergentSince = msg.t;
          this.divergentMidi = frame.midiFloat;
        } else {
          this.divergentHops++;
        }
        if (this.divergentHops >= 2) {
          out.noteOff = { id: note.id, t: this.divergentSince };
          this.attackFrames = [frame];
          const legato = this.emitNote(this.divergentSince - this.opts.hopMs / 2000, "legato", 0.3);
          out.noteOn = legato;
          this.divergentHops = 0;
        }
      } else {
        this.divergentHops = 0;
      }
      return out;
    }
    return out;
  }

  private emitNote(t: number, kind: NoteEvent["kind"], strength: number): NoteEvent {
    const frames = this.attackFrames.slice().sort((a, b) => a.midiFloat - b.midiFloat);
    const med = frames[Math.floor(frames.length / 2)];
    const spread = frames.length > 1 ? frames[frames.length - 1].midiFloat - frames[0].midiFloat : 0;
    const stability = Math.max(0, 1 - spread / 0.5);
    const midi = Math.round(med.midiFloat);
    const note: NoteEvent = {
      id: this.nextId++,
      t,
      tPerf: this.audioToPerf(t),
      midi,
      midiFloat: med.midiFloat,
      cents: (med.midiFloat - midi) * 100,
      hz: med.hz,
      confidence: Math.max(0, Math.min(1, med.clarity * stability)),
      strength,
      kind,
    };
    this.note = note;
    this.attackFrames = [];
    this.divergentHops = 0;
    this.octaveHops = 0;
    this.silentSince = null;
    this.unvoicedHops = 0;
    return note;
  }
}
