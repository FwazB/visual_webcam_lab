import { midiToHz } from "@/lib/instrument/pitch";
import type { Instrument } from "./music";
import { requestPlaybackSession } from "./playbackSession";

interface Playback {
  starting: boolean;
  playing: boolean;
  activeIndex: number | null;
  error: string | null;
}

export const IDLE_PLAYBACK: Playback = { starting: false, playing: false, activeIndex: null, error: null };
const AUDIO_ERROR = "Audio couldn’t start. Tap a chord or Play loop to try again.";

/** Integer beat boundaries are relative to the chosen starting chord, including on repeat. */
function loopClock(count: number, bpm: number, startIndex: number, beats?: number[]) {
  let total = 0;
  const ends = Array.from({ length: count }, (_, slot) => {
    const duration = beats?.[(startIndex + slot) % count] ?? 4;
    total += Number.isInteger(duration) && duration >= 1 && duration <= 16 ? duration : 4;
    return total;
  });
  const secondsPerBeat = 60 / bpm;
  return {
    slotAt(seconds: number) {
      const beat = Math.max(0, seconds / secondsPerBeat) + 1e-9;
      const pass = Math.floor(beat / total);
      const withinPass = beat - pass * total;
      return pass * count + ends.findIndex(end => withinPass < end);
    },
    startOf(slot: number) {
      const preceding = ends[slot % count - 1] ?? 0;
      return (Math.floor(slot / count) * total + preceding) * secondsPerBeat;
    },
  };
}

/** Owns its audio clock and voices so previews never touch another instrument's transport. */
export class ProgressionPlayer {
  private context: AudioContext | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseSession: (() => void) | null = null;
  private voices = new Map<OscillatorNode, GainNode>();

  constructor(
    private readonly update: (state: Playback) => void,
    private readonly createContext = () => new AudioContext({ latencyHint: "interactive" }),
  ) {}

  private clearResumeTimer() {
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  private silence() {
    this.generation++;
    this.clearResumeTimer();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.context) this.context.onstatechange = null;
    for (const [osc, gain] of this.voices) {
      osc.onended = null;
      osc.disconnect();
      gain.disconnect();
      try { osc.stop(); } catch { /* Graph construction may have failed before start. */ }
    }
    this.voices.clear();
  }

  private closeContext() {
    const ctx = this.context;
    this.context = null;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== "closed") void ctx.close().catch(() => {});
    }
    this.releaseSession?.();
    this.releaseSession = null;
  }

  stop = () => {
    this.silence();
    this.closeContext();
    this.update(IDLE_PLAYBACK);
  };

  play = (voices: number[][], instrument: Instrument, bpm: number, startIndex = 0, beats?: number[]) => {
    if (!voices.length || !Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) { this.stop(); return; }
    const index = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < voices.length ? startIndex : 0;
    void this.start(voices, instrument, loopClock(voices.length, bpm, index, beats), index);
  };

  preview = (midis: number[], instrument: Instrument) => {
    void this.start([midis], instrument, null, 0);
  };

  private async start(voices: number[][], instrument: Instrument, clock: ReturnType<typeof loopClock> | null, startIndex: number) {
    this.silence();
    const run = this.generation;
    // Preserve doubled notes while strumming only the strings shown on the diagram.
    const chords = voices.map(notes => notes.filter(n => Number.isInteger(n) && n >= 0 && n <= 127).sort((a, b) => a - b));
    if (!chords.length || chords.some(notes => !notes.length)) { this.stop(); return; }
    const fail = (message = AUDIO_ERROR) => {
      if (run !== this.generation) return;
      this.silence();
      this.closeContext();
      this.update({ ...IDLE_PLAYBACK, error: message });
    };
    try {
      if (!this.context) {
        this.releaseSession = requestPlaybackSession();
        this.context = this.createContext();
      }
      const ctx = this.context;
      if (ctx.state !== "running") {
        this.update({ ...IDLE_PLAYBACK, starting: true });
        // A blocked resume can stay pending until a future gesture. Allow a fresh attempt.
        this.resumeTimer = setTimeout(fail, 4000);
        await ctx.resume();
        if (run !== this.generation) return;
        this.clearResumeTimer();
      }
      if (ctx.state !== "running") { fail(); return; }
      ctx.onstatechange = () => {
        if (ctx.state !== "running") fail("Playback was interrupted. Tap a chord or Play loop to resume.");
      };
      // Upper bass harmonics carry low roots on small speakers while keeping the same pitch.
      const harmonics = instrument === "guitar" ? [0, 1, 0.48, 0.24, 0.12, 0.07]
        : [0, 1, 0.44, 0.30, 0.22, 0.19, 0.16, 0.10, 0.07];
      const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
      const origin = ctx.currentTime + 0.015;
      if (clock === null) {
        this.strum(ctx, wave, instrument, chords[0], origin, 1.8, true);
        this.update(IDLE_PLAYBACK);
        return;
      }
      let scheduled = -1;
      let displayed = -1;
      const tick = () => {
        if (run !== this.generation) return;
        try {
          const now = ctx.currentTime;
          const current = clock.slotAt(now - origin);
          // Queue attacks on the audio clock, and skip missed chords after a stalled frame.
          const upcoming = clock.slotAt(now + 0.1 - origin);
          for (let slot = Math.max(current, scheduled + 1); slot <= upcoming; slot++) {
            const start = origin + clock.startOf(slot);
            const end = origin + clock.startOf(slot + 1);
            const when = Math.max(now, start);
            const remaining = end - when;
            if (remaining > Math.min(0.1, (end - start) / 2)) {
              this.strum(ctx, wave, instrument, chords[(startIndex + slot) % chords.length], when, remaining, false);
            }
          }
          scheduled = upcoming;
          if (displayed !== current) {
            displayed = current;
            this.update({ starting: false, playing: true, activeIndex: (startIndex + current) % chords.length, error: null });
          }
        } catch { fail(); }
      };
      this.timer = setInterval(tick, 40);
      tick();
    } catch { fail(); }
  }

  private strum(ctx: AudioContext, wave: PeriodicWave, instrument: Instrument, notes: number[],
    when: number, duration: number, oneShot: boolean) {
    const length = Math.min(duration, instrument === "guitar" ? 2.2 : 1.65);
    const spacing = Math.min(instrument === "guitar" ? 0.025 : 0.014, length / (notes.length + 1));
    const level = 0.36 / notes.length;
    notes.forEach((midi, index) => {
      const start = when + index * spacing;
      const end = when + length;
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();
      this.voices.set(osc, gain);
      osc.setPeriodicWave(wave);
      osc.frequency.value = midiToHz(midi);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.onended = () => {
        if (!this.voices.delete(osc)) return;
        osc.disconnect();
        gain.disconnect();
        if (oneShot && this.voices.size === 0) this.closeContext();
      };
      osc.start(start);
      osc.stop(end);
    });
  }
}
