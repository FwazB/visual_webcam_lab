// Audio–vision fusion: a played pitch constrains (string, fret); combined
// with fingertip positions in neck coordinates it identifies which finger
// played where, votes on integer fret-offset corrections for the neck model,
// and estimates per-string lane offsets.

import type { FingerName } from "@/lib/neck/fretHand";
import type { NoteEvent, NoteOff } from "@/lib/audio/pitchTypes";
import { candidatePositions } from "./positions";
import type { InstrumentProfile } from "./profile";

export interface NeckCoord {
  /** Fret-wire units: u = f at wire f; a finger pressing fret f sits in (f−1, f]. */
  u: number;
  /** String lane, 0 = lowest-pitched string. */
  v: number;
}

export interface NeckFrame {
  k: number;
  confidence: number;
  stringCount: number;
  fretCount: number;
}

export interface FingertipInput {
  finger: FingerName;
  neck: NeckCoord | null;
  /** How long the fingertip has been roughly still (ms). */
  stationaryMs: number;
}

export type Pressing = "confirmed" | "likely" | "idle";

export interface LastConfirmed {
  s: number;
  f: number;
  finger: FingerName | "open";
  t: number;
  midi: number;
  cost: number;
  ambiguous: boolean;
  unmatched: boolean;
  noteId: number;
}

export interface FusionOutput {
  lastConfirmed: LastConfirmed | null;
  /** Non-zero when the neck model should be relabelled by this many frets now. */
  deltaK: number;
  stringOffsets: number[];
  pressing: Record<FingerName, Pressing>;
  fusionConfidence: number;
  verdict: "unverified" | "verified" | "reject";
  debug: { histogram: number[]; candidates: Array<{ s: number; f: number; cost: number }> };
}

const K_MIN = -4;
const K_MAX = 4;
const BINS = K_MAX - K_MIN + 1;
const APPLY_MASS = 2.2;
const APPLY_RATIO = 2;
const ACCEPT_COST = 1.2;
const AMBIGUOUS_MARGIN = 0.35;
const PRESS_OFFSET = 0.3;

const FINGERS: FingerName[] = ["index", "middle", "ring", "pinky"];

export class NeckFusion {
  private profile: InstrumentProfile;
  private hist = new Float32Array(BINS);
  private lastVoteT = 0;
  private cooldownUntil = 0;
  private stringOffsets: number[];
  private stringVotes: number[];
  private agreeRate = 0.5;
  private lastEventT = 0;
  private consecutiveBad = 0;
  private lastConfirmed: LastConfirmed | null = null;
  private activeNoteId: number | null = null;
  private verified = false;
  private rejected = false;
  private pressing: Record<FingerName, Pressing> = { index: "idle", middle: "idle", ring: "idle", pinky: "idle" };
  private lastCandidates: Array<{ s: number; f: number; cost: number }> = [];

  constructor(profile: InstrumentProfile) {
    this.profile = profile;
    this.stringOffsets = new Array(profile.stringCount).fill(0);
    this.stringVotes = new Array(profile.stringCount).fill(0);
  }

  reset(): void {
    this.hist.fill(0);
    this.stringOffsets.fill(0);
    this.stringVotes.fill(0);
    this.agreeRate = 0.5;
    this.consecutiveBad = 0;
    this.lastConfirmed = null;
    this.activeNoteId = null;
    this.verified = false;
    this.rejected = false;
    this.cooldownUntil = 0;
  }

  private correctedV(v: number): number {
    const s = Math.round(v);
    const off = this.stringOffsets[Math.max(0, Math.min(this.profile.stringCount - 1, s))] ?? 0;
    return v - off;
  }

  onNoteOff(e: NoteOff): void {
    if (this.activeNoteId === e.id) {
      this.activeNoteId = null;
      for (const f of FINGERS) if (this.pressing[f] === "confirmed") this.pressing[f] = "idle";
    }
  }

  onNote(evt: NoteEvent, fingertips: FingertipInput[], neck: NeckFrame | null): FusionOutput {
    const candidates = candidatePositions(this.profile, evt.midi);
    let deltaK = 0;
    this.lastEventT = evt.t;
    if (candidates.length === 0) {
      return this.output(deltaK);
    }
    const tips = fingertips.filter((f) => f.neck !== null) as Array<FingertipInput & { neck: NeckCoord }>;
    // Score every candidate against every fingertip.
    const scored: Array<{ s: number; f: number; cost: number; finger: FingerName | "open"; dv: number; du: number }> = [];
    for (const c of candidates) {
      if (c.fret === 0) {
        const onLane = tips.some((tp) => Math.abs(this.correctedV(tp.neck.v) - c.string) <= 0.5);
        scored.push({ s: c.string, f: 0, cost: onLane ? 1.6 : 0.8, finger: "open", dv: 0, du: 0 });
        continue;
      }
      let best: (typeof scored)[number] | null = null;
      for (const tp of tips) {
        const du = tp.neck.u - (c.fret - PRESS_OFFSET);
        const dv = this.correctedV(tp.neck.v) - c.string;
        const cost = Math.sqrt(du * du + (1.4 * dv) ** 2);
        if (!best || cost < best.cost) best = { s: c.string, f: c.fret, cost, finger: tp.finger, dv, du };
      }
      if (best) scored.push(best);
      else scored.push({ s: c.string, f: c.fret, cost: 3, finger: "open", dv: 0, du: 0 });
    }
    scored.sort((a, b) => a.cost - b.cost);
    this.lastCandidates = scored.map((c) => ({ s: c.s, f: c.f, cost: c.cost }));
    const best = scored[0];
    const second = scored[1];
    const accepted = best.cost <= ACCEPT_COST;
    const ambiguous = !!second && second.cost - best.cost < AMBIGUOUS_MARGIN;

    this.lastConfirmed = {
      s: best.s,
      f: best.f,
      finger: best.finger,
      t: evt.t,
      midi: evt.midi,
      cost: best.cost,
      ambiguous,
      unmatched: !accepted,
      noteId: evt.id,
    };
    this.activeNoteId = evt.id;
    for (const f of FINGERS) if (this.pressing[f] === "confirmed") this.pressing[f] = "idle";
    if (accepted && best.finger !== "open") this.pressing[best.finger] = "confirmed";

    // Agreement statistics.
    const good = accepted && !ambiguous;
    this.agreeRate += 0.3 * ((good ? 1 : 0) - this.agreeRate);
    const strongEvidence = neck && neck.confidence > 0.5 && evt.confidence > 0.8;
    if (best.cost > 2.0 && strongEvidence) this.consecutiveBad++;
    else this.consecutiveBad = 0;

    // Integer fret-offset votes: only unambiguous notes with a fingertip on
    // the same string, and only when the audio disagrees by a whole number
    // of frets within the histogram range.
    if (neck && best.finger !== "open" && !ambiguous && evt.t >= this.cooldownUntil) {
      const tp = tips.find((x) => x.finger === best.finger);
      if (tp && Math.abs(best.dv) <= 0.5) {
        const fHat = Math.ceil(tp.neck.u);
        const delta = best.f - fHat;
        if (delta >= K_MIN && delta <= K_MAX) {
          const dt = evt.t - this.lastVoteT;
          const timeDecay = this.lastVoteT > 0 ? Math.exp(-Math.max(0, dt) / 10) : 1;
          for (let i = 0; i < BINS; i++) this.hist[i] *= 0.75 * timeDecay;
          const w = evt.confidence * Math.max(0.2, neck.confidence) * Math.exp(-(best.dv * best.dv) / 0.18);
          this.hist[delta - K_MIN] += w;
          this.lastVoteT = evt.t;
          let bestBin = 0;
          let bestMass = -1;
          let secondMass = 0;
          for (let i = 0; i < BINS; i++) {
            if (this.hist[i] > bestMass) {
              secondMass = bestMass;
              bestMass = this.hist[i];
              bestBin = i + K_MIN;
            } else if (this.hist[i] > secondMass) {
              secondMass = this.hist[i];
            }
          }
          if (bestBin !== 0 && bestMass >= APPLY_MASS && bestMass >= APPLY_RATIO * Math.max(secondMass, 1e-6)) {
            deltaK = bestBin;
            this.hist.fill(0);
            this.cooldownUntil = evt.t + 1.0;
            this.verified = false;
          } else if (bestBin === 0 && bestMass >= APPLY_MASS) {
            this.verified = true;
          }
        }
      }
      // String-lane disagreement: fingertip about one lane off.
      if (tp && accepted && Math.abs(best.dv) > 0.5 && Math.abs(best.dv) <= 1.5) {
        const r = best.s - tp.neck.v;
        const s = best.s;
        this.stringVotes[s] = Math.min(5, this.stringVotes[s] + 1);
        if (this.stringVotes[s] >= 2) {
          this.stringOffsets[s] += 0.25 * (r - this.stringOffsets[s]);
          this.stringOffsets[s] = Math.max(-0.6, Math.min(0.6, this.stringOffsets[s]));
        }
      }
    }

    // Reject: the model is inconsistent, not merely offset.
    if (this.consecutiveBad >= 5) this.rejected = true;
    return this.output(deltaK);
  }

  tick(t: number, fingertips: FingertipInput[], neck: NeckFrame | null): FusionOutput {
    for (const tp of fingertips) {
      if (this.pressing[tp.finger] === "confirmed") continue;
      const near =
        tp.neck !== null &&
        neck !== null &&
        Math.abs(this.correctedV(tp.neck.v) - Math.round(this.correctedV(tp.neck.v))) <= 0.35 &&
        tp.neck.u >= -0.5 &&
        tp.neck.u <= neck.fretCount + 0.5 &&
        tp.stationaryMs >= 100;
      this.pressing[tp.finger] = near ? "likely" : "idle";
    }
    // Confidence decays toward the vision floor when no notes arrive.
    if (this.lastEventT > 0 && t - this.lastEventT > 5) {
      this.agreeRate += 0.02 * (0.5 - this.agreeRate);
    }
    return this.output(0, neck);
  }

  private output(deltaK: number, neck: NeckFrame | null = null): FusionOutput {
    const neckConf = neck?.confidence ?? 0.5;
    const fusionConfidence = Math.max(0, Math.min(1, 0.4 * neckConf + 0.6 * this.agreeRate));
    return {
      lastConfirmed: this.lastConfirmed,
      deltaK,
      stringOffsets: this.stringOffsets.slice(),
      pressing: { ...this.pressing },
      fusionConfidence,
      verdict: this.rejected ? "reject" : this.verified ? "verified" : "unverified",
      debug: { histogram: Array.from(this.hist), candidates: this.lastCandidates },
    };
  }

  /** Call after the owner handled a `reject` (re-detected the neck). */
  clearReject(): void {
    this.rejected = false;
    this.consecutiveBad = 0;
    this.hist.fill(0);
  }
}
