// Recorder AudioWorklet: captures the input from an exact AudioContext frame
// so takes line up with the timeline. Audio is posted in chunks of about
// 170 ms; "stop" flushes the rest and answers "stopped". Independent input
// levels are reported at about 10 Hz, without routing input to the speakers.

const CHUNK_FRAMES = 8192;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.startFrame = 0;
    this.pending = [];
    this.pendingFrames = 0;
    this.recordingChannels = 1;
    this.quantumFrames = typeof renderQuantumSize === "number" && renderQuantumSize > 0 ? renderQuantumSize : 128;
    this.generation = 0;
    this.meterFrames = 0;
    this.peaks = [];
    this.squares = [];
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "start") {
        this.recording = true;
        this.startFrame = msg.frame;
        this.pending = [];
        this.pendingFrames = 0;
      } else if (msg.type === "stop") {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: "stopped" });
      } else if (msg.type === "reset-meter") {
        this.generation = msg.generation;
        this.meterFrames = 0;
        this.peaks = [];
        this.squares = [];
      }
    };
  }

  flush() {
    if (this.pendingFrames === 0) return;
    const channelCount = this.pending.reduce((count, block) => Math.max(count, block.length), 0);
    const channels = [];
    for (let c = 0; c < channelCount; c++) {
      const out = new Float32Array(this.pendingFrames);
      let at = 0;
      for (const block of this.pending) {
        // A block with fewer channels (input changed) repeats its first one.
        const src = block[c] ?? block[0];
        out.set(src, at);
        at += src.length;
      }
      channels.push(out);
    }
    this.pending = [];
    this.pendingFrames = 0;
    this.port.postMessage({ type: "data", channels }, channels.map((ch) => ch.buffer));
  }

  meter(input, frames) {
    for (let c = 0; c < input.length; c++) {
      let peak = this.peaks[c] ?? 0, square = this.squares[c] ?? 0;
      for (let i = 0; i < input[c].length; i++) {
        const value = input[c][i];
        peak = Math.max(peak, Math.abs(value));
        square += value * value;
      }
      this.peaks[c] = peak;
      this.squares[c] = square;
    }
    this.meterFrames += frames;
    if (this.meterFrames >= sampleRate / 10) {
      this.port.postMessage({ type: "level", generation: this.generation, frame: currentFrame + frames,
        peaks: this.peaks, rms: this.squares.map((sum) => Math.sqrt(sum / this.meterFrames)) });
      this.meterFrames = 0;
      this.peaks = [];
      this.squares = [];
    }
  }

  process(inputs) {
    const input = inputs[0] ?? [];
    const frames = input[0]?.length ?? this.quantumFrames;
    this.quantumFrames = frames;
    this.meter(input, frames);
    if (input.length) this.recordingChannels = input.length;
    if (!this.recording) return true;
    const skip = Math.max(0, this.startFrame - currentFrame);
    if (skip >= frames) return true;
    // Preserve the timeline even when the input disconnects mid-take.
    this.pending.push(input.length ? input.map((ch) => ch.slice(skip))
      : Array.from({ length: this.recordingChannels }, () => new Float32Array(frames - skip)));
    this.pendingFrames += frames - skip;
    if (this.pendingFrames >= CHUNK_FRAMES) this.flush();
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("recorder-processor", RecorderProcessor);
}
