// Studio audio engine: plays clips on a shared timeline, clicks a metronome
// (with count-in), records the input sample-accurately through the recorder
// worklet, and renders an offline mixdown.

import { anySolo, effectiveGain, projectEnd, type Project } from "./project";

export type TransportMode = "stopped" | "playing" | "recording";

export interface RecordedTake {
  channels: Float32Array[];
  sampleRate: number;
  /** Timeline time of the first sample after latency compensation (may be < 0). */
  start: number;
}

export interface PlayOptions {
  bpm: number;
  beatsPerBar: number;
  metronome: boolean;
}

const RECORDER_URL = "/worklets/recorder-processor.js";
/** Delay between a transport command and the first scheduled sound (s). */
const START_DELAY = 0.08;
/** How far ahead the metronome is scheduled (s). */
const LOOKAHEAD = 0.15;

export class StudioEngine {
  readonly ctx: AudioContext;
  mode: TransportMode = "stopped";
  private master: GainNode;
  private clickOut: GainNode;
  private recorder: AudioWorkletNode;
  private trackGains = new Map<string, GainNode>();
  private sources: AudioBufferSourceNode[] = [];
  private input: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private anchorCtx = 0;
  private anchorTimeline = 0;
  private stoppedAt = 0;
  private opts: PlayOptions = { bpm: 96, beatsPerBar: 4, metronome: true };
  private clickTimer: number | null = null;
  private nextBeat = 0;
  /** Clicks sound before this timeline time even with the metronome off. */
  private countInEnd = -Infinity;
  private take: { chunks: Float32Array[][]; start: number; from: number } | null = null;
  private onStopped: (() => void) | null = null;

  private constructor(ctx: AudioContext, recorder: AudioWorkletNode) {
    this.ctx = ctx;
    this.recorder = recorder;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.clickOut = ctx.createGain();
    this.clickOut.gain.value = 0.5;
    this.clickOut.connect(ctx.destination);
    recorder.port.onmessage = (e: MessageEvent<{ type: string; channels?: Float32Array[] }>) => {
      if (e.data.type === "data" && e.data.channels) this.take?.chunks.push(e.data.channels);
      else if (e.data.type === "stopped") this.onStopped?.();
    };
  }

  static async create(): Promise<StudioEngine> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    try {
      await ctx.audioWorklet.addModule(RECORDER_URL);
      const recorder = new AudioWorkletNode(ctx, "recorder-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCountMode: "max",
      });
      return new StudioEngine(ctx, recorder);
    } catch (err) {
      ctx.close().catch(() => {});
      throw err;
    }
  }

  get hasInput(): boolean {
    return this.input !== null;
  }

  /** Timeline position now (s); negative during a count-in from 0. */
  position(): number {
    return this.mode === "stopped" ? this.stoppedAt : this.anchorTimeline + (this.ctx.currentTime - this.anchorCtx);
  }

  seek(t: number): void {
    if (this.mode === "stopped") this.stoppedAt = Math.max(0, t);
  }

  attachInput(stream: MediaStream): void {
    this.detachInput();
    this.stream = stream;
    this.input = this.ctx.createMediaStreamSource(stream);
    this.input.connect(this.recorder);
  }

  detachInput(): void {
    this.input?.disconnect();
    this.input = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  /** Output latency plus the input latency the browser reports (s). */
  estimatedLatency(): number {
    const settings = this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    return (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0) + (settings?.latency ?? 0);
  }

  setTrackGain(trackId: string, gain: number): void {
    const node = this.trackGains.get(trackId);
    if (node) {
      node.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01);
      return;
    }
    const created = this.ctx.createGain();
    created.gain.value = gain;
    created.connect(this.master);
    this.trackGains.set(trackId, created);
  }

  /** Start playback at timeline `from`, after `preroll` seconds of count-in. */
  play(from: number, project: Project, buffers: Map<string, AudioBuffer>, opts: PlayOptions, preroll = 0): number {
    this.halt();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.opts = opts;
    this.countInEnd = -Infinity;
    const startCtx = this.ctx.currentTime + START_DELAY;
    this.anchorCtx = startCtx;
    this.anchorTimeline = from - preroll;
    const solo = anySolo(project);
    for (const track of project.tracks) this.setTrackGain(track.id, effectiveGain(track, solo));
    for (const clip of project.clips) {
      const buffer = buffers.get(clip.bufferId);
      const out = this.trackGains.get(clip.trackId);
      if (!buffer || !out || clip.start + clip.duration <= from) continue;
      const late = Math.max(0, from - clip.start);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(out);
      source.start(startCtx + preroll + Math.max(0, clip.start - from), clip.offset + late, clip.duration - late);
      this.sources.push(source);
    }
    this.nextBeat = Math.ceil(this.anchorTimeline / (60 / opts.bpm) - 1e-9);
    this.scheduleClicks();
    this.clickTimer = window.setInterval(() => this.scheduleClicks(), 25);
    this.mode = "playing";
    return startCtx;
  }

  /**
   * Record from timeline `from`. With count-in, one bar of clicks plays first.
   * `latency` (s) shifts the take earlier so it lines up with what was heard.
   */
  record(from: number, project: Project, buffers: Map<string, AudioBuffer>, opts: PlayOptions, latency: number, countIn: boolean): void {
    if (!this.input) throw new Error("Connect an input before recording.");
    const preroll = countIn ? (opts.beatsPerBar * 60) / opts.bpm : 0;
    const startCtx = this.play(from, project, buffers, opts, preroll);
    this.countInEnd = from;
    this.take = { chunks: [], start: from - latency, from };
    this.recorder.port.postMessage({ type: "start", frame: Math.round((startCtx + preroll) * this.ctx.sampleRate) });
    this.mode = "recording";
  }

  /** Stop the transport; resolves with the take when recording. */
  async stop(): Promise<RecordedTake | null> {
    const wasRecording = this.mode === "recording";
    const at = this.position();
    const take = this.take;
    this.halt();
    this.stoppedAt = Math.max(0, take ? Math.max(take.from, at) : at);
    if (!wasRecording || !take) return null;
    await new Promise<void>((resolve) => {
      // A suspended or closed context never answers; do not hang the UI.
      const timeout = window.setTimeout(resolve, 1000);
      this.onStopped = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.recorder.port.postMessage({ type: "stop" });
    });
    this.onStopped = null;
    this.take = null;
    if (take.chunks.length === 0) return null;
    const channelCount = Math.max(...take.chunks.map((c) => c.length));
    const frames = take.chunks.reduce((n, c) => n + c[0].length, 0);
    const channels = Array.from({ length: channelCount }, (_, ch) => {
      const out = new Float32Array(frames);
      let pos = 0;
      for (const chunk of take.chunks) {
        out.set(chunk[ch] ?? chunk[0], pos);
        pos += chunk[0].length;
      }
      return out;
    });
    return { channels, sampleRate: this.ctx.sampleRate, start: take.start };
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  close(): void {
    this.halt();
    this.detachInput();
    this.recorder.disconnect();
    this.ctx.close().catch(() => {});
  }

  private halt(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources = [];
    if (this.clickTimer !== null) window.clearInterval(this.clickTimer);
    this.clickTimer = null;
    this.mode = "stopped";
  }

  private scheduleClicks(): void {
    const spb = 60 / this.opts.bpm;
    const now = this.ctx.currentTime;
    const bpb = this.opts.beatsPerBar;
    for (;;) {
      const t = this.nextBeat * spb;
      const at = this.anchorCtx + (t - this.anchorTimeline);
      if (at > now + LOOKAHEAD) break;
      if (at >= now - 0.01 && (this.opts.metronome || t < this.countInEnd - 1e-6)) {
        this.click(at, ((this.nextBeat % bpb) + bpb) % bpb === 0);
      }
      this.nextBeat++;
    }
  }

  private click(at: number, accent: boolean): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = accent ? 1600 : 1000;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.5, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(env).connect(this.clickOut);
    osc.start(at);
    osc.stop(at + 0.06);
  }
}

/** Render every audible clip to a stereo buffer (null for an empty project). */
export async function renderMix(project: Project, buffers: Map<string, AudioBuffer>, sampleRate: number): Promise<AudioBuffer | null> {
  const end = projectEnd(project);
  if (end <= 0) return null;
  const offline = new OfflineAudioContext(2, Math.ceil(end * sampleRate), sampleRate);
  const solo = anySolo(project);
  const outs = new Map<string, GainNode>();
  for (const track of project.tracks) {
    const gain = offline.createGain();
    gain.gain.value = effectiveGain(track, solo);
    gain.connect(offline.destination);
    outs.set(track.id, gain);
  }
  for (const clip of project.clips) {
    const buffer = buffers.get(clip.bufferId);
    const out = outs.get(clip.trackId);
    if (!buffer || !out) continue;
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    source.start(clip.start, clip.offset, clip.duration);
  }
  return offline.startRendering();
}
