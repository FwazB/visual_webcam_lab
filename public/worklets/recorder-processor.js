// Recorder AudioWorklet: captures the input from an exact AudioContext frame
// so takes line up with the timeline. Audio is posted in chunks of about
// 170 ms; "stop" flushes the rest and answers "stopped".

const CHUNK_FRAMES = 8192;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.startFrame = 0;
    this.pending = [];
    this.pendingFrames = 0;
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
      }
    };
  }

  flush() {
    if (this.pendingFrames === 0) return;
    const channelCount = this.pending[0].length;
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

  process(inputs) {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const frames = input[0].length;
    const skip = Math.max(0, this.startFrame - currentFrame);
    if (skip >= frames) return true;
    this.pending.push(input.map((ch) => ch.slice(skip)));
    this.pendingFrames += frames - skip;
    if (this.pendingFrames >= CHUNK_FRAMES) this.flush();
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("recorder-processor", RecorderProcessor);
}
