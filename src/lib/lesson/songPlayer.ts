// Pure chart clock and scorer for song practice.
// Position is expressed in beats since the transport started (after count-in).

import type { InstrumentProfile } from "@/lib/instrument/profile";
import { midiAt } from "@/lib/instrument/profile";
import { pitchClassOf } from "@/lib/instrument/pitch";
import type { NoteEvent } from "@/lib/audio/pitchTypes";
import type { ChordVoicing, SongChart } from "./songs";

export interface ChartPosition {
  /** Absolute chart beat, negative during the count-in. */
  absoluteBeat: number;
  sectionIndex: number;
  /** Index into the section loop. */
  barIndex: number;
  chordId: string;
  /** Beats elapsed inside this chord slot. */
  beatInChord: number;
  /** Total beats of this chord slot. */
  chordBeats: number;
  /** 0-based beat inside the bar. */
  beatInBar: number;
  /** Which pass of the loop (0-based). */
  loopIndex: number;
  /** Beats until the next chord change. */
  beatsToChange: number;
  nextChordId: string;
  finished: boolean;
}

/** Total beats of one pass of a section's loop. */
export function loopBeats(chart: SongChart, sectionIndex: number): number {
  return chart.sections[sectionIndex].loop.reduce((a, b) => a + b.beats, 0);
}

export function chartPositionAt(chart: SongChart, beats: number): ChartPosition {
  let remaining = Math.max(0, beats);
  let loopIndexOffset = 0;
  for (let si = 0; si < chart.sections.length; si++) {
    const sec = chart.sections[si];
    const lb = loopBeats(chart, si);
    const total = sec.repeats > 0 ? lb * sec.repeats : Infinity;
    if (remaining >= total) {
      remaining -= total;
      loopIndexOffset += sec.repeats;
      continue;
    }
    const loopIndex = Math.floor(remaining / lb);
    let inLoop = remaining - loopIndex * lb;
    for (let bi = 0; bi < sec.loop.length; bi++) {
      const bar = sec.loop[bi];
      if (inLoop < bar.beats) {
        const next = sec.loop[(bi + 1) % sec.loop.length];
        return {
          absoluteBeat: beats,
          sectionIndex: si,
          barIndex: bi,
          chordId: bar.chordId,
          beatInChord: inLoop,
          chordBeats: bar.beats,
          beatInBar: ((beats % chart.beatsPerBar) + chart.beatsPerBar) % chart.beatsPerBar,
          loopIndex: loopIndexOffset + loopIndex,
          beatsToChange: bar.beats - inLoop,
          nextChordId: next.chordId,
          finished: false,
        };
      }
      inLoop -= bar.beats;
    }
  }
  const last = chart.sections[chart.sections.length - 1];
  const lastBar = last.loop[last.loop.length - 1];
  return {
    absoluteBeat: beats,
    sectionIndex: chart.sections.length - 1,
    barIndex: last.loop.length - 1,
    chordId: lastBar.chordId,
    beatInChord: lastBar.beats,
    chordBeats: lastBar.beats,
    beatInBar: 0,
    loopIndex: loopIndexOffset,
    beatsToChange: 0,
    nextChordId: lastBar.chordId,
    finished: true,
  };
}

export function voicingFor(chart: SongChart, profile: InstrumentProfile, chordId: string): ChordVoicing | null {
  return chart.voicings[profile.id]?.[chordId] ?? null;
}

export function chordPitchClasses(profile: InstrumentProfile, v: ChordVoicing): Set<number> {
  return new Set(v.notes.map((n) => pitchClassOf(midiAt(profile, n.s, n.f))));
}

export interface ChordSlotScore {
  chordId: string;
  loopIndex: number;
  barIndex: number;
  /** Distinct chord tones played (by pitch class). */
  tonesHit: Set<number>;
  tonesTotal: number;
  wrongNotes: number;
  notes: number;
}

export interface SongScoreSummary {
  slotsPlayed: number;
  /** Mean fraction of chord tones hit per slot, 0..1. */
  accuracy: number;
  wrongNotes: number;
  /** Consecutive fully-hit slots. */
  streak: number;
  bestStreak: number;
  current: ChordSlotScore | null;
}

interface ScoredSlot extends ChordSlotScore {
  startBeat: number;
  chordBeats: number;
}

/**
 * Scores played notes against the chord active at their time. A slot counts
 * as clean when all its chord tones (by pitch class) were played and no wrong
 * note occurred.
 */
export class SongScorer {
  private chart: SongChart;
  private profile: InstrumentProfile;
  private slots: ScoredSlot[] = [];
  private current: ScoredSlot | null = null;
  private pending = new Map<number, ScoredSlot>();
  private archivedStreak = 0;
  private archivedBestStreak = 0;
  private pcCache = new Map<string, Set<number>>();

  constructor(chart: SongChart, profile: InstrumentProfile) {
    this.chart = chart;
    this.profile = profile;
  }

  reset(chart?: SongChart): void {
    if (chart) this.chart = chart;
    this.slots = [];
    this.current = null;
    this.pending.clear();
    this.archivedStreak = 0;
    this.archivedBestStreak = 0;
    this.pcCache.clear();
  }

  private pcsFor(chordId: string): Set<number> {
    let pcs = this.pcCache.get(chordId);
    if (!pcs) {
      const v = voicingFor(this.chart, this.profile, chordId);
      pcs = v ? chordPitchClasses(this.profile, v) : new Set();
      this.pcCache.set(chordId, pcs);
    }
    return pcs;
  }

  /** Advance the clock; closes a slot when the chord changes. */
  tick(pos: ChartPosition): void {
    if (pos.absoluteBeat < 0 || pos.finished) return;
    if (!this.current) this.current = this.slotFor(chartPositionAt(this.chart, 0));
    // Count missed/quiet slots too, and never move backwards for a delayed note.
    while (this.current.startBeat + this.current.chordBeats <= pos.absoluteBeat) {
      const next = chartPositionAt(this.chart, this.current.startBeat + this.current.chordBeats);
      if (next.finished) break;
      this.closeSlot(this.current);
      this.current = this.slotFor(next);
      this.pending.delete(this.current.startBeat);
    }
  }

  private slotFor(pos: ChartPosition): ScoredSlot {
    const startBeat = pos.absoluteBeat - pos.beatInChord;
    const existing = this.current?.startBeat === startBeat ? this.current
      : this.slots.find((slot) => slot.startBeat === startBeat) ?? this.pending.get(startBeat);
    if (existing) return existing;
    const slot: ScoredSlot = {
      startBeat,
      chordBeats: pos.chordBeats,
      chordId: pos.chordId,
      loopIndex: pos.loopIndex,
      barIndex: pos.barIndex,
      tonesHit: new Set(),
      tonesTotal: this.pcsFor(pos.chordId).size,
      wrongNotes: 0,
      notes: 0,
    };
    this.pending.set(startBeat, slot);
    return slot;
  }

  private isClean(slot: ChordSlotScore): boolean {
    return slot.tonesHit.size >= slot.tonesTotal && slot.wrongNotes === 0 && slot.tonesTotal > 0;
  }

  private closeSlot(slot: ScoredSlot): void {
    this.slots.push(slot);
    this.pending.delete(slot.startBeat);
    if (this.slots.length > 200) {
      const archived = this.slots.shift()!;
      this.archivedStreak = this.isClean(archived) ? this.archivedStreak + 1 : 0;
      this.archivedBestStreak = Math.max(this.archivedBestStreak, this.archivedStreak);
    }
  }

  /** Score a note against the chord active at the note's beat position. */
  onNote(evt: NoteEvent, posAtNote: ChartPosition): { chordTone: boolean } {
    if (posAtNote.absoluteBeat < 0 || posAtNote.finished) return { chordTone: false };
    this.tick(posAtNote);
    // Notes played right before a change count for the upcoming chord.
    const early = posAtNote.beatsToChange < 0.25;
    const target = early
      ? chartPositionAt(this.chart, posAtNote.absoluteBeat + posAtNote.beatsToChange)
      : posAtNote;
    const pcs = this.pcsFor(target.chordId);
    const pc = pitchClassOf(evt.midi);
    const chordTone = pcs.has(pc);
    const slot = this.slotFor(target);
    slot.notes++;
    if (chordTone) slot.tonesHit.add(pc);
    else slot.wrongNotes++;
    return { chordTone };
  }

  summary(): SongScoreSummary {
    let streak = this.archivedStreak;
    let bestStreak = this.archivedBestStreak;
    for (const slot of this.slots) {
      streak = this.isClean(slot) ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
    }
    const played = this.slots.filter((s) => s.tonesTotal > 0);
    const accuracy = played.length
      ? played.reduce((a, s) => a + Math.min(1, s.tonesHit.size / s.tonesTotal), 0) / played.length
      : 0;
    return {
      slotsPlayed: played.length,
      accuracy,
      wrongNotes: this.slots.reduce((a, s) => a + s.wrongNotes, this.current?.wrongNotes ?? 0),
      streak,
      bestStreak,
      current: this.current,
    };
  }
}
