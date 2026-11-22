import { midiToHz } from "@/lib/instrument/pitch";

type Instrument = "guitar" | "bass";
interface Playback {
  playing: boolean;
  activeIndex: number | null;
  error: string | null;
}

export const IDLE_PLAYBACK: Playback = { playing: false, activeIndex: null, error: null };
const AUDIO_ERROR = "Audio is unavailable. Tap Play or Hear chord to try again.";

/** Owns its audio clock and voices so previews never touch another instrument's transport. */
export class ProgressionPlayer {
  private context: AudioContext | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voices = new Map<OscillatorNode, GainNode>();

  constructor(
    private readonly update: (state: Playback) => void,
    private readonly createContext = () => new AudioContext({ latencyHint: "interactive" }),
  ) {}

  private silence() {
    this.generation++;
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
  }

  stop = () => {
    this.silence();
    this.closeContext();
    this.update(IDLE_PLAYBACK);
  };

  play = (voices: number[][], instrument: Instrument, bpm: number, startIndex = 0) => {
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 1000) { this.stop(); return; }
    const index = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < voices.length ? startIndex : 0;
    void this.start(voices, instrument, 240 / bpm, index);
  };

  preview = (midis: number[], instrument: Instrument) => {
    void this.start([midis], instrument, null, 0);
  };

  private async start(voices: number[][], instrument: Instrument, bar: number | null, startIndex: number) {
    this.silence();
    const run = this.generation;
    // Preserve doubled notes while strumming only the strings shown on the diagram.
    const chords = voices.map(notes => notes.filter(n => Number.isInteger(n) && n >= 0 && n <= 127).sort((a, b) => a - b));
    if (!chords.length || chords.some(notes => !notes.length)) { this.stop(); return; }
    this.update({ playing: bar !== null, activeIndex: null, error: null });
    const fail = () => {
      if (run !== this.generation) return;
      this.silence();
      this.closeContext();
      this.update({ ...IDLE_PLAYBACK, error: AUDIO_ERROR });
    };
    try {
      const ctx = this.context ??= this.createContext();
      if (ctx.state !== "running") await ctx.resume();
      if (run !== this.generation) return;
      if (ctx.state !== "running") { fail(); return; }
      ctx.onstatechange = () => { if (ctx.state !== "running") fail(); };
      const harmonics = instrument === "guitar" ? [0, 1, 0.48, 0.24, 0.12, 0.07] : [0, 1, 0.3, 0.11];
      const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
      const origin = ctx.currentTime + 0.015;
      if (bar === null) {
        this.strum(ctx, wave, instrument, chords[0], origin, 1.8, true);
        return;
      }
      let scheduled = -1;
      let displayed = -1;
      const tick = () => {
        if (run !== this.generation) return;
        try {
          const now = ctx.currentTime;
          const current = Math.max(0, Math.floor((now - origin) / bar));
          // Queue the next attack on the audio clock, and skip missed bars after a stalled frame.
          const upcoming = Math.max(current, Math.floor((now + 0.1 - origin) / bar));
          for (let slot = Math.max(current, scheduled + 1); slot <= upcoming; slot++) {
            const when = Math.max(now, origin + slot * bar);
            const remaining = origin + (slot + 1) * bar - when;
            if (remaining > 0.1) this.strum(ctx, wave, instrument, chords[(startIndex + slot) % chords.length], when, remaining, false);
          }
          scheduled = upcoming;
          if (displayed !== current) {
            displayed = current;
            this.update({ playing: true, activeIndex: (startIndex + current) % chords.length, error: null });
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
