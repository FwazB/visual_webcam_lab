// Pure chart clock and scorer for song practice.
// Position is expressed in beats since the transport started (after count-in).

import type { InstrumentProfile } from "@/lib/instrument/profile";
import { midiAt } from "@/lib/instrument/profile";
import { pitchClassOf } from "@/lib/instrument/pitch";
import type { NoteEvent } from "@/lib/audio/pitchTypes";
import type { ChordVoicing, SongChart } from "./songs";

export interface ChartPosition {
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

/**
 * Scores played notes against the chord active at their time. A slot counts
 * as clean when all its chord tones (by pitch class) were played and no wrong
 * note occurred.
 */
export class SongScorer {
  private chart: SongChart;
  private profile: InstrumentProfile;
  private slots: ChordSlotScore[] = [];
  private current: ChordSlotScore | null = null;
  private streak = 0;
  private bestStreak = 0;
  private pcCache = new Map<string, Set<number>>();

  constructor(chart: SongChart, profile: InstrumentProfile) {
    this.chart = chart;
    this.profile = profile;
  }

  reset(chart?: SongChart): void {
    if (chart) this.chart = chart;
    this.slots = [];
    this.current = null;
    this.streak = 0;
    this.bestStreak = 0;
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
    const cur = this.current;
    if (cur && cur.loopIndex === pos.loopIndex && cur.barIndex === pos.barIndex) return;
    if (cur) this.closeSlot(cur);
    this.current = {
      chordId: pos.chordId,
      loopIndex: pos.loopIndex,
      barIndex: pos.barIndex,
      tonesHit: new Set(),
      tonesTotal: this.pcsFor(pos.chordId).size,
      wrongNotes: 0,
      notes: 0,
    };
  }

  private closeSlot(slot: ChordSlotScore): void {
    this.slots.push(slot);
    const clean = slot.tonesHit.size >= slot.tonesTotal && slot.wrongNotes === 0 && slot.tonesTotal > 0;
    this.streak = clean ? this.streak + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    if (this.slots.length > 200) this.slots.splice(0, this.slots.length - 200);
  }

  /** Score a note against the chord active at the note's beat position. */
  onNote(evt: NoteEvent, posAtNote: ChartPosition): { chordTone: boolean } {
    // Notes played right before a change count for the upcoming chord.
    const early = posAtNote.beatsToChange < 0.25;
    const chordId = early ? posAtNote.nextChordId : posAtNote.chordId;
    const pcs = this.pcsFor(chordId);
    const pc = pitchClassOf(evt.midi);
    const chordTone = pcs.has(pc);
    const slot = this.current;
    if (slot && slot.chordId === chordId) {
      slot.notes++;
      if (chordTone) slot.tonesHit.add(pc);
      else slot.wrongNotes++;
    }
    return { chordTone };
  }

  summary(): SongScoreSummary {
    const played = this.slots.filter((s) => s.tonesTotal > 0);
    const accuracy = played.length
      ? played.reduce((a, s) => a + Math.min(1, s.tonesHit.size / s.tonesTotal), 0) / played.length
      : 0;
    return {
      slotsPlayed: played.length,
      accuracy,
      wrongNotes: this.slots.reduce((a, s) => a + s.wrongNotes, 0),
      streak: this.streak,
      bestStreak: this.bestStreak,
      current: this.current,
    };
  }
}
