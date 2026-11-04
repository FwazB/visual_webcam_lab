import type { NoteEvent } from "@/lib/audio/pitchTypes";
import type { InstrumentProfile } from "@/lib/instrument/profile";

export interface HighwayPattern {
  name: string;
  notes: { string: number; fret: number; midi: number; beat: number }[];
  lengthBeats: number;
}

export interface HighwayNote {
  id: number;
  beat: number;
  string: number;
  fret: number;
  midi: number;
  state: "pending" | "perfect" | "good" | "miss";
}

export interface HighwayFeedback {
  kind: "perfect" | "good" | "wrong" | "miss";
  /** Input onset beat, or the current beat when a missed target finishes its delivery grace. */
  beat: number;
  noteId?: number;
}

export interface HighwaySummary {
  score: number;
  hits: number;
  misses: number;
  wrong: number;
  streak: number;
  bestStreak: number;
  /** Percentage of hits among hits, missed targets, and wrong notes; 0 before playing. */
  accuracy: number;
  feedback: HighwayFeedback | null;
}

const PERFECT_SECONDS = 0.09;
const GOOD_SECONDS = 0.22;
const DELIVERY_GRACE_SECONDS = 0.25;
const PITCH_TOLERANCE = 0.35;
const HISTORY_LIMIT = 128;
const MIN_SPACING = 1 / 8;
const MAX_BPM = 600;
const EPSILON = 1e-9;

/** One note per beat, low string to high string; the standard guitar/bass E-minor run. */
export function createHighwayPattern(profile: InstrumentProfile): HighwayPattern {
  if (!Number.isInteger(profile.stringCount) || profile.stringCount < 1 || profile.stringCount > 12
    || profile.tuning.length !== profile.stringCount || !Number.isInteger(profile.fretCount) || profile.fretCount < 3
    || profile.tuning.some(midi => !Number.isInteger(midi) || midi < 0 || midi > 124)) {
    throw new Error("A note highway needs a valid fretted-instrument tuning.");
  }
  const notes = profile.tuning.flatMap((open, string) => {
    const frets = [0, [4, 11].includes(open % 12) ? 3 : 2];
    return frets.map((fret, i) => ({ string, fret, midi: open + fret, beat: string * 2 + i }));
  });
  return { name: "E minor run", notes, lengthBeats: notes.length };
}

function validTempo(bpm: number): boolean {
  return Number.isFinite(bpm) && bpm > 0 && bpm <= MAX_BPM;
}

function validEvent(event: NoteEvent): boolean {
  return Number.isSafeInteger(event.id) && event.id >= 0 && Number.isFinite(event.t) && event.t >= 0
    && Number.isInteger(event.midi) && event.midi >= 0 && event.midi <= 127
    && Number.isFinite(event.midiFloat) && event.midiFloat >= 0 && event.midiFloat <= 127
    && Number.isFinite(event.cents) && Number.isFinite(event.hz) && event.hz > 0
    && Number.isFinite(event.confidence) && event.confidence >= 0 && event.confidence <= 1
    && Number.isFinite(event.strength) && event.strength >= 0 && event.strength <= 1
    && (event.kind === "pluck" || event.kind === "legato");
}

/**
 * Monophonic audio scoring on an externally supplied beat clock. It never uses camera observations.
 * Pattern offsets are separated by at least 1/8 beat and tempo is limited to 600 BPM, keeping all
 * unresolved timing windows smaller than the bounded judgment history. Restart the clock with reset().
 */
export class HighwayGame {
  private readonly pattern: HighwayPattern;
  private readonly hitsById = new Map<number, "perfect" | "good">();
  private finalizedCount = 0;
  private historyFloor = 0;
  private lastBeat = -Infinity;
  private lastEventId = -1;
  private lastHitId = -1;
  private totals: HighwaySummary = { score: 0, hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, accuracy: 0, feedback: null };

  constructor(pattern: HighwayPattern) {
    if (!pattern || !Array.isArray(pattern.notes) || !pattern.notes.length || pattern.notes.length > HISTORY_LIMIT
      || !Number.isFinite(pattern.lengthBeats) || pattern.lengthBeats <= 0 || typeof pattern.name !== "string") {
      throw new Error("A note highway needs a bounded, nonempty repeating pattern.");
    }
    let previous = -Infinity;
    for (const note of pattern.notes) {
      if (!note || !Number.isInteger(note.string) || note.string < 0 || note.string > 11
        || !Number.isInteger(note.fret) || note.fret < 0 || note.fret > 36
        || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127
        || !Number.isFinite(note.beat) || note.beat < 0 || note.beat >= pattern.lengthBeats
        || note.beat - previous < MIN_SPACING - EPSILON) {
        throw new Error("Highway notes must be ordered, valid pitches at least 1/8 beat apart.");
      }
      previous = note.beat;
    }
    if (pattern.lengthBeats - previous + pattern.notes[0].beat < MIN_SPACING - EPSILON) {
      throw new Error("The repeating pattern must preserve note spacing across its loop.");
    }
    this.pattern = { name: pattern.name, lengthBeats: pattern.lengthBeats, notes: pattern.notes.map(note => ({ ...note })) };
  }

  reset(): void {
    this.hitsById.clear();
    this.finalizedCount = 0;
    this.historyFloor = 0;
    this.lastBeat = -Infinity;
    this.lastEventId = -1;
    this.lastHitId = -1;
    this.totals = { score: 0, hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, accuracy: 0, feedback: null };
  }

  /** Half-open [startBeat, endBeat), at most 128 notes. Old pruned history is omitted. */
  notesBetween(startBeat: number, endBeat: number): HighwayNote[] {
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) return [];
    const start = this.countBefore(startBeat), end = this.countBefore(endBeat);
    if (start === null || end === null) return [];
    const first = Math.max(start, this.historyFloor);
    const notes: HighwayNote[] = [];
    for (let id = first; id < end && notes.length < HISTORY_LIMIT; id++) notes.push(this.noteAt(id));
    return notes;
  }

  /** Account for missed targets without iterating over an arbitrarily long idle interval. */
  advance(beat: number, bpm: number): void {
    if (!Number.isFinite(beat) || !validTempo(bpm) || beat < this.lastBeat) return;
    const next = this.countBefore(beat - (GOOD_SECONDS + DELIVERY_GRACE_SECONDS) * bpm / 60);
    if (next === null) return;
    this.lastBeat = beat;
    if (next <= this.finalizedCount) return;
    let judgedHits = 0;
    for (const id of this.hitsById.keys()) if (id >= this.finalizedCount && id < next) judgedHits++;
    const missed = next - this.finalizedCount - judgedHits;
    if (missed > 0) {
      this.totals.misses += missed;
      let lastMiss = next - 1;
      while (this.hitsById.has(lastMiss)) lastMiss--;
      // An older miss may finish its delivery grace after a later target has already been hit.
      if (lastMiss >= this.lastHitId) this.totals.streak = 0;
      this.totals.feedback = { kind: "miss", beat, noteId: lastMiss };
    }
    this.finalizedCount = next;
    this.prune();
  }

  /** beat is the physical onset converted by the transport, not delivery/animation time. */
  onNote(event: NoteEvent, beat: number, bpm: number): HighwayFeedback | null {
    if (!Number.isFinite(beat) || !validTempo(bpm) || !validEvent(event) || event.id <= this.lastEventId
      || this.countBefore(beat) === null) return null;
    // NoteTracker IDs increase for the life of the tracker. A high-water mark never forgets a replay.
    this.lastEventId = event.id;
    if (beat < 0) return null;
    this.advance(beat, bpm);
    const target = this.nearestMatching(beat, bpm, event) ?? this.nearestPending(beat);
    const seconds = target ? Math.abs(target.beat - beat) * 60 / bpm : Infinity;
    const inWindow = target !== null && seconds <= GOOD_SECONDS + EPSILON;
    const matches = inWindow && event.midi === target.midi && Math.abs(event.midiFloat - target.midi) <= PITCH_TOLERANCE + EPSILON;
    let feedback: HighwayFeedback;
    if (matches && target) {
      const kind = seconds <= PERFECT_SECONDS + EPSILON ? "perfect" : "good";
      this.hitsById.set(target.id, kind);
      this.totals.score += kind === "perfect" ? 100 : 60;
      this.totals.hits++;
      this.totals.streak = target.id === this.lastHitId + 1 ? this.totals.streak + 1 : 1;
      this.lastHitId = target.id;
      this.totals.bestStreak = Math.max(this.totals.bestStreak, this.totals.streak);
      feedback = { kind, beat, noteId: target.id };
      this.prune();
    } else {
      this.totals.wrong++;
      this.totals.streak = 0;
      feedback = inWindow && target ? { kind: "wrong", beat, noteId: target.id } : { kind: "wrong", beat };
    }
    this.totals.feedback = feedback;
    return { ...feedback };
  }

  summary(): HighwaySummary {
    const { hits, misses, wrong } = this.totals;
    const judgments = hits + misses + wrong;
    return { ...this.totals, accuracy: judgments ? hits / judgments * 100 : 0,
      feedback: this.totals.feedback ? { ...this.totals.feedback } : null };
  }

  /** Number of target onsets strictly before beat; safe integer IDs are part of the public contract. */
  private countBefore(beat: number): number | null {
    if (beat <= 0) return 0;
    const cycles = Math.floor(beat / this.pattern.lengthBeats);
    const remainder = beat - cycles * this.pattern.lengthBeats;
    let low = 0, high = this.pattern.notes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.pattern.notes[middle].beat < remainder - EPSILON) low = middle + 1;
      else high = middle;
    }
    const count = cycles * this.pattern.notes.length + low;
    return Number.isSafeInteger(count) ? count : null;
  }

  private noteAt(id: number): HighwayNote {
    const note = this.pattern.notes[id % this.pattern.notes.length];
    const beat = Math.floor(id / this.pattern.notes.length) * this.pattern.lengthBeats + note.beat;
    return { ...note, id, beat, state: this.hitsById.get(id) ?? (id < this.finalizedCount ? "miss" : "pending") };
  }

  private nearestPending(beat: number): HighwayNote | null {
    const at = this.countBefore(beat);
    if (at === null) return null;
    let before = at - 1, after = Math.max(at, this.finalizedCount);
    while (before >= this.finalizedCount && this.hitsById.has(before)) before--;
    while (this.hitsById.has(after)) after++;
    if (!Number.isSafeInteger(after)) return null;
    const next = this.noteAt(after);
    if (before < this.finalizedCount) return next;
    const previous = this.noteAt(before);
    return beat - previous.beat <= next.beat - beat + EPSILON ? previous : next;
  }

  private nearestMatching(beat: number, bpm: number, event: NoteEvent): HighwayNote | null {
    const windowBeats = GOOD_SECONDS * bpm / 60;
    const start = this.countBefore(beat - windowBeats);
    const end = this.countBefore(beat + windowBeats + EPSILON * 2);
    if (start === null || end === null) return null;
    let best: HighwayNote | null = null;
    let distance = Infinity;
    // Pattern spacing and tempo validation limit this window to fewer than 40 targets.
    for (let id = Math.max(start, this.finalizedCount), examined = 0; id < end && examined < HISTORY_LIMIT; id++, examined++) {
      if (this.hitsById.has(id)) continue;
      const target = this.noteAt(id);
      const delta = Math.abs(target.beat - beat);
      if (delta <= windowBeats + EPSILON && event.midi === target.midi
        && Math.abs(event.midiFloat - target.midi) <= PITCH_TOLERANCE + EPSILON && delta < distance - EPSILON) {
        best = target;
        distance = delta;
      }
    }
    return best;
  }

  private prune(): void {
    this.historyFloor = Math.max(this.historyFloor, this.finalizedCount - HISTORY_LIMIT);
    for (const id of this.hitsById.keys()) if (id < this.historyFloor) this.hitsById.delete(id);
    while (this.hitsById.size > HISTORY_LIMIT) {
      const oldest = Math.min(...this.hitsById.keys());
      this.hitsById.delete(oldest);
      this.historyFloor = Math.max(this.historyFloor, oldest + 1);
    }
  }
}
