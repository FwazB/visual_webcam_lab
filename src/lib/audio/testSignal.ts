// Synthetic guitar-like test signals routed into the detection chain, plus a
// chromatic sweep for measuring octave errors.

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
  /** Disable injection and cancel every active voice and pending sweep. */
  setEnabled: (enabled: boolean) => void;
  /** Play a plucked note into `target`; returns the stop time. */
  playPluck: (midi: number, opts?: { durationMs?: number; drive?: number; monitor?: boolean }) => number;
  /** Chromatic sweep; resolves with the played notes and their times. */
  sweep: (midiFrom: number, midiTo: number, opts?: { drive?: number; noteMs?: number; gapMs?: number }) => Promise<Array<{ midi: number; t: number }>>;
}

export function createTestSignal(ctx: AudioContext, target: AudioNode): TestSignal {
  let enabled = true;
  let generation = 0;
  const active = new Set<() => void>();
  const waiting = new Set<() => void>();

  const setEnabled = (next: boolean) => {
    enabled = next;
    if (next) return;
    generation++;
    for (const cancel of [...waiting]) cancel();
    for (const cancel of [...active]) cancel();
  };

  const wait = (milliseconds: number) => new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); waiting.delete(finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    waiting.add(finish);
  });

  const playPluck: TestSignal["playPluck"] = (midi, opts = {}) => {
    if (!enabled || ctx.state === "closed") return ctx.currentTime;
    const durationMs = opts.durationMs ?? 600;
    const t0 = ctx.currentTime + 0.02;
    const nodes: AudioNode[] = [];
    let osc: OscillatorNode | null = null;
    const release = () => {
      if (!active.delete(release)) return;
      if (osc) {
        osc.onended = null;
        try { osc.stop(); } catch { /* A completed or partially built voice may already be stopped. */ }
      }
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* Release the rest of a partially built graph. */ }
      }
    };
    active.add(release);
    try {
      osc = ctx.createOscillator(); nodes.push(osc);
      osc.type = "sawtooth";
      osc.frequency.value = midiToHz(midi);
      osc.onended = release;
      const shaper = ctx.createWaveShaper(); nodes.push(shaper);
      shaper.curve = driveCurve(opts.drive ?? 0);
      const env = ctx.createGain(); nodes.push(env);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.5, t0 + 0.004);
      env.gain.exponentialRampToValueAtTime(0.18, t0 + 0.4);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
      osc.connect(shaper).connect(env).connect(target);
      if (opts.monitor) {
        const mon = ctx.createGain(); nodes.push(mon);
        mon.gain.value = 0.1;
        env.connect(mon).connect(ctx.destination);
      }
      osc.start(t0);
      osc.stop(t0 + durationMs / 1000 + 0.05);
      return t0 + durationMs / 1000;
    } catch (cause) {
      release();
      throw cause;
    }
  };

  const sweep: TestSignal["sweep"] = async (midiFrom, midiTo, opts = {}) => {
    const noteMs = opts.noteMs ?? 500;
    const gapMs = opts.gapMs ?? 150;
    const played: Array<{ midi: number; t: number }> = [];
    const started = generation;
    if (!Number.isInteger(midiFrom) || !Number.isInteger(midiTo) || midiFrom < 0 || midiTo > 127
      || !Number.isFinite(noteMs) || noteMs <= 0 || !Number.isFinite(gapMs) || gapMs < 0) return played;
    for (let midi = midiFrom; midi <= midiTo; midi++) {
      if (!enabled || started !== generation || ctx.state === "closed") break;
      const t = ctx.currentTime + 0.02;
      playPluck(midi, { durationMs: noteMs, drive: opts.drive });
      played.push({ midi, t });
      await wait(noteMs + gapMs);
    }
    return played;
  };

  return { setEnabled, playPluck, sweep };
}
