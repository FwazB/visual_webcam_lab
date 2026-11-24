import { midiToHz } from "@/lib/instrument/pitch";
import type { Instrument } from "./music";
import { requestPlaybackSession } from "./playbackSession";

interface Playback {
  starting: boolean;
  playing: boolean;
  metronome: boolean;
  activeIndex: number | null;
  error: string | null;
}

export const IDLE_PLAYBACK: Playback = { starting: false, playing: false, metronome: false, activeIndex: null, error: null };
const AUDIO_ERROR = "Audio couldn’t start. Tap a playback control to try again.";
const LOOKAHEAD = 0.1;
const EPSILON = 1e-9;

function validTempo(bpm: number) {
  return Number.isFinite(bpm) && bpm > 0 && bpm <= 1000;
}

function pitches(notes: number[]) {
  return notes.filter(n => Number.isInteger(n) && n >= 0 && n <= 127).sort((a, b) => a - b);
}

/** Chord boundaries in beats, relative to the chosen starting chord. */
function loopClock(count: number, startIndex: number, beats?: number[]) {
  let total = 0;
  const ends = Array.from({ length: count }, (_, slot) => {
    const duration = beats?.[(startIndex + slot) % count] ?? 4;
    total += Number.isInteger(duration) && duration >= 1 && duration <= 16 ? duration : 4;
    return total;
  });
  return {
    slotAt(position: number) {
      const beat = Math.max(0, position) + EPSILON;
      const pass = Math.floor(beat / total);
      const withinPass = beat - pass * total;
      return pass * count + ends.findIndex(end => withinPass < end);
    },
    startOf(slot: number) {
      return Math.floor(slot / count) * total + (ends[slot % count - 1] ?? 0);
    },
  };
}

interface Loop {
  chords: number[][];
  instrument: Instrument;
  startIndex: number;
  firstBeat: number;
  clock: ReturnType<typeof loopClock>;
  scheduled: number;
  wave: PeriodicWave | null;
}

interface Voice { gain: GainNode; attack: number; kind: "click" | "loop" | "preview" }

/** The loop and metronome share an audio clock. Previews can ring over a solo click. */
export class ProgressionPlayer {
  private context: AudioContext | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseSession: (() => void) | null = null;
  private voices = new Map<OscillatorNode, Voice>();
  private loop: Loop | null = null;
  private pendingPreview: { notes: number[]; instrument: Instrument } | null = null;
  private metronome = false;
  private bpm = 84;
  private origin: number | null = null;
  private lastClick = -1;
  private state = IDLE_PLAYBACK;

  constructor(
    private readonly update: (state: Playback) => void,
    private readonly createContext = () => new AudioContext({ latencyHint: "interactive" }),
  ) {}

  private publish(starting = false, activeIndex: number | null = null, error: string | null = null) {
    const playing = this.loop !== null && !starting;
    const metronome = this.metronome;
    if (this.state.playing === playing && this.state.starting === starting && this.state.activeIndex === activeIndex &&
        this.state.metronome === metronome && this.state.error === error) return;
    this.state = { starting, playing, activeIndex, metronome, error };
    this.update(this.state);
  }

  private clearResumeTimer() {
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  private discard(shouldStop: (voice: Voice) => boolean) {
    for (const [osc, voice] of this.voices) {
      if (!shouldStop(voice)) continue;
      this.voices.delete(osc);
      osc.onended = null;
      osc.disconnect();
      voice.gain.disconnect();
      try { osc.stop(); } catch { /* Graph construction may have failed before start. */ }
    }
  }

  private releaseIfIdle() {
    if (this.metronome || this.loop) return;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.origin = null;
    if (this.pendingPreview || this.voices.size) return;
    const ctx = this.context;
    this.context = null;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== "closed") void ctx.close().catch(() => {});
    }
    this.releaseSession?.();
    this.releaseSession = null;
  }

  private reset(error: string | null) {
    this.generation++;
    this.clearResumeTimer();
    this.metronome = false;
    this.loop = null;
    this.pendingPreview = null;
    this.discard(() => true);
    this.releaseIfIdle();
    this.publish(false, null, error);
  }

  stop = () => this.reset(null);

  stopLoop = () => {
    if (!this.metronome) { this.stop(); return; }
    this.loop = null;
    this.pendingPreview = null;
    this.discard(voice => voice.kind !== "click");
    this.publish(this.state.starting);
  };

  play = (voices: number[][], instrument: Instrument, bpm: number, startIndex = 0, beats?: number[]) => {
    const chords = voices.map(pitches);
    if (!chords.length || chords.some(notes => !notes.length) || !validTempo(bpm)) { this.stop(); return; }
    const index = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < chords.length ? startIndex : 0;
    this.pendingPreview = null;
    this.loop = null;
    this.discard(voice => voice.kind !== "click");
    if (!this.metronome) this.origin = null;
    this.setTempo(bpm);
    this.loop = {
      chords, instrument, startIndex: index, firstBeat: this.nextBeat(), clock: loopClock(chords.length, index, beats),
      scheduled: -1, wave: null,
    };
    void this.activate();
  };

  preview = (midis: number[], instrument: Instrument) => {
    const notes = pitches(midis);
    if (!notes.length) { this.stopLoop(); return; }
    this.loop = null;
    this.pendingPreview = { notes, instrument };
    this.discard(voice => voice.kind !== "click");
    this.releaseIfIdle();
    void this.activate();
  };

  private nextBeat() {
    if (this.origin === null || !this.context) return 0;
    return Math.max(0, Math.ceil((this.context.currentTime - this.origin) * this.bpm / 60 - EPSILON));
  }

  toggleMetronome = (bpm: number) => {
    if (this.metronome) {
      this.metronome = false;
      this.discard(voice => voice.kind === "click");
      if (!this.loop && !this.voices.size && !this.pendingPreview) { this.stop(); return; }
      this.releaseIfIdle();
      this.publish(this.state.starting, this.state.activeIndex);
      return;
    }
    if (!validTempo(bpm)) return;
    this.setTempo(bpm);
    this.metronome = true;
    this.lastClick = this.nextBeat() - 1;
    void this.activate();
  };

  setTempo = (bpm: number) => {
    if (!validTempo(bpm) || bpm === this.bpm) return;
    if (this.origin !== null && this.context) {
      const now = this.context.currentTime;
      const beat = (now - this.origin) * this.bpm / 60;
      // Reschedule future attacks at the new tempo. Preserve the current fractional beat
      // and all strings of a strum whose first note has already sounded.
      this.discard(voice => voice.kind !== "preview" && voice.attack > now);
      this.lastClick = Math.min(this.lastClick, Math.floor(beat + EPSILON));
      if (this.loop) {
        const position = beat - this.loop.firstBeat;
        this.loop.scheduled = Math.min(this.loop.scheduled, position < -EPSILON ? -1 : this.loop.clock.slotAt(position));
      }
      if (beat >= 0) this.origin = now - beat * 60 / bpm;
    }
    this.bpm = bpm;
    this.tick();
  };

  private async activate() {
    const run = ++this.generation;
    this.clearResumeTimer();
    const fail = (message = AUDIO_ERROR) => {
      if (run === this.generation) this.reset(message);
    };
    try {
      if (!this.context) {
        this.releaseSession = requestPlaybackSession();
        this.context = this.createContext();
      }
      const ctx = this.context;
      if (ctx.state !== "running") {
        this.publish(true);
        this.resumeTimer = setTimeout(fail, 4000);
        await ctx.resume();
        if (run !== this.generation) return;
        this.clearResumeTimer();
      }
      if (ctx.state !== "running") { fail(); return; }
      ctx.onstatechange = () => {
        if (ctx.state !== "running") fail("Playback was interrupted. Tap a playback control to resume.");
      };
      if (this.pendingPreview) {
        const { notes, instrument } = this.pendingPreview;
        this.pendingPreview = null;
        this.strum(ctx, this.wave(ctx, instrument), instrument, notes, ctx.currentTime + 0.015, 1.8, "preview");
      }
      if (this.metronome || this.loop) {
        this.origin ??= ctx.currentTime + 0.015;
        if (this.timer === null) this.timer = setInterval(this.tick, 40);
        this.tick();
      } else {
        this.publish();
      }
    } catch { fail(); }
  }

  private tick = () => {
    const ctx = this.context;
    if (!ctx || this.origin === null) return;
    try {
      const now = ctx.currentTime;
      const spb = 60 / this.bpm;
      const beat = (now - this.origin) / spb;
      const ahead = (now + LOOKAHEAD - this.origin) / spb;
      if (this.metronome) {
        // Skip elapsed clicks after a scheduler stall instead of sounding a catch-up burst.
        const first = Math.max(0, this.lastClick + 1, Math.ceil(beat - 0.01 / spb));
        const last = Math.floor(ahead + EPSILON);
        for (let i = first; i <= last; i++) this.click(ctx, Math.max(now, this.origin + i * spb));
        this.lastClick = Math.max(this.lastClick, last);
      }
      const loop = this.loop;
      if (!loop) { this.publish(); return; }
      const current = loop.clock.slotAt(beat - loop.firstBeat);
      if (ahead >= loop.firstBeat - EPSILON) {
        const upcoming = loop.clock.slotAt(ahead - loop.firstBeat);
        loop.wave ??= this.wave(ctx, loop.instrument);
        for (let slot = Math.max(current, loop.scheduled + 1); slot <= upcoming; slot++) {
          const start = this.origin + (loop.firstBeat + loop.clock.startOf(slot)) * spb;
          const end = this.origin + (loop.firstBeat + loop.clock.startOf(slot + 1)) * spb;
          const when = Math.max(now, start);
          const remaining = end - when;
          if (remaining > Math.min(0.1, (end - start) / 2)) {
            this.strum(ctx, loop.wave, loop.instrument, loop.chords[(loop.startIndex + slot) % loop.chords.length], when, remaining, "loop");
          }
        }
        loop.scheduled = upcoming;
      }
      this.publish(false, (loop.startIndex + current) % loop.chords.length);
    } catch { this.reset(AUDIO_ERROR); }
  };

  private wave(ctx: AudioContext, instrument: Instrument) {
    // Upper bass harmonics carry low roots on small speakers while keeping the same pitch.
    const harmonics = instrument === "guitar" ? [0, 1, 0.48, 0.24, 0.12, 0.07]
      : [0, 1, 0.44, 0.30, 0.22, 0.19, 0.16, 0.10, 0.07];
    return ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
  }

  private voice(ctx: AudioContext, attack: number, kind: Voice["kind"]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    this.voices.set(osc, { gain, attack, kind });
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => {
      if (!this.voices.delete(osc)) return;
      osc.disconnect();
      gain.disconnect();
      this.releaseIfIdle();
    };
    return { osc, gain };
  }

  private click(ctx: AudioContext, when: number) {
    const { osc, gain } = this.voice(ctx, when, "click");
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.24, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.start(when);
    osc.stop(when + 0.045);
  }

  private strum(ctx: AudioContext, wave: PeriodicWave, instrument: Instrument, notes: number[],
    when: number, duration: number, kind: "loop" | "preview") {
    const length = Math.min(duration, instrument === "guitar" ? 2.2 : 1.65);
    const spacing = Math.min(instrument === "guitar" ? 0.025 : 0.014, length / (notes.length + 1));
    const level = 0.36 / notes.length;
    notes.forEach((midi, index) => {
      const start = when + index * spacing;
      const end = when + length;
      const { osc, gain } = this.voice(ctx, when, kind);
      osc.setPeriodicWave(wave);
      osc.frequency.value = midiToHz(midi);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.start(start);
      osc.stop(end);
    });
  }
}
