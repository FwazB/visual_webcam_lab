// Synthetic guitar-like test signals routed into the detection chain, plus a
// clip player and a chromatic sweep for measuring octave errors.

import { midiToHz } from "@/lib/instrument/pitch";

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + amount * 20;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export interface TestSignal {
  /** Play a plucked note into `target`; returns the stop time. */
  playPluck: (midi: number, opts?: { durationMs?: number; drive?: number; monitor?: boolean }) => number;
  loadClip: (url: string) => Promise<void>;
  playClip: () => void;
  stopClip: () => void;
  /** Chromatic sweep; resolves with the played notes and their times. */
  sweep: (midiFrom: number, midiTo: number, opts?: { drive?: number; noteMs?: number; gapMs?: number }) => Promise<Array<{ midi: number; t: number }>>;
}

export function createTestSignal(ctx: AudioContext, target: AudioNode): TestSignal {
  let clip: AudioBuffer | null = null;
  let clipSource: AudioBufferSourceNode | null = null;

  const playPluck: TestSignal["playPluck"] = (midi, opts = {}) => {
    const durationMs = opts.durationMs ?? 600;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiToHz(midi);
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(opts.drive ?? 0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.5, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.18, t0 + 0.4);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
    osc.connect(shaper).connect(env).connect(target);
    if (opts.monitor) {
      const mon = ctx.createGain();
      mon.gain.value = 0.1;
      env.connect(mon).connect(ctx.destination);
    }
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000 + 0.05);
    return t0 + durationMs / 1000;
  };

  const loadClip = async (url: string) => {
    const res = await fetch(url);
    clip = await ctx.decodeAudioData(await res.arrayBuffer());
  };

  const stopClip = () => {
    clipSource?.stop();
    clipSource = null;
  };

  const playClip = () => {
    if (!clip) return;
    stopClip();
    const src = ctx.createBufferSource();
    src.buffer = clip;
    src.connect(target);
    src.start();
    clipSource = src;
  };

  const sweep: TestSignal["sweep"] = async (midiFrom, midiTo, opts = {}) => {
    const noteMs = opts.noteMs ?? 500;
    const gapMs = opts.gapMs ?? 150;
    const played: Array<{ midi: number; t: number }> = [];
    for (let midi = midiFrom; midi <= midiTo; midi++) {
      const t = ctx.currentTime + 0.02;
      playPluck(midi, { durationMs: noteMs, drive: opts.drive });
      played.push({ midi, t });
      await new Promise((r) => setTimeout(r, noteMs + gapMs));
    }
    return played;
  };

  return { playPluck, loadClip, playClip, stopClip, sweep };
}
