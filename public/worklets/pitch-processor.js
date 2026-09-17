// Pitch/onset AudioWorklet processor.
// - Per 128-sample block: DC block, smoothed RMS envelope, energy onset trigger.
// - Per hop: McLeod Pitch Method (NSDF) on the last `window` samples.
// All timestamps are AudioContext seconds taken from `currentTime` in the
// worklet, so downstream latency never shifts them.

const DEFAULT_CONFIG = {
  fMin: 60,
  fMax: 1500,
  windowMs: 46,
  hopMs: 11.6,
  clarityThreshold: 0.85,
  gateDb: -45,
  k: 0.9,
  onsetRiseDb: 6,
  refractoryMs: 60,
};

/**
 * McLeod Pitch Method. Returns { lag, clarity } or null.
 * x: Float32Array of length N (most recent samples, oldest first).
 */
export function mpm(x, N, minLag, maxLag, k, scratch) {
  const nsdf = scratch.nsdf;
  // m(0) = 2·Σx²; m(τ) = m(τ−1) − x[τ−1]² − x[N−τ]²
  let sumSq = 0;
  for (let j = 0; j < N; j++) sumSq += x[j] * x[j];
  if (sumSq <= 1e-12) return null;
  let m = 2 * sumSq;
  nsdf[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
    let acf = 0;
    const lim = N - tau;
    for (let j = 0; j < lim; j++) acf += x[j] * x[j + tau];
    nsdf[tau] = m > 1e-12 ? (2 * acf) / m : 0;
  }
  // Key maxima: after the first negative-going zero crossing, the maximum of
  // each positive run.
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;
  const maxima = scratch.maxima;
  let count = 0;
  let vMax = -Infinity;
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    if (tau > maxLag) break;
    let best = tau;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (nsdf[tau] > nsdf[best]) best = tau;
      tau++;
    }
    if (best >= minLag && best > 1 && best < maxLag) {
      const a = nsdf[best - 1];
      const b = nsdf[best];
      const c = nsdf[best + 1];
      const denom = a - 2 * b + c;
      const delta = Math.abs(denom) > 1e-12 ? (0.5 * (a - c)) / denom : 0;
      const v = b - 0.25 * (a - c) * delta;
      maxima[count * 2] = best + delta;
      maxima[count * 2 + 1] = v;
      count++;
      if (v > vMax) vMax = v;
      if (count * 2 >= maxima.length) break;
    }
  }
  if (count === 0) return null;
  const threshold = k * vMax;
  for (let i = 0; i < count; i++) {
    if (maxima[i * 2 + 1] >= threshold) return { lag: maxima[i * 2], clarity: maxima[i * 2 + 1] };
  }
  return null;
}

class PitchProcessor extends (typeof AudioWorkletProcessor === "function" ? AudioWorkletProcessor : class {}) {
  constructor() {
    super();
    this.config = { ...DEFAULT_CONFIG };
    this.applyConfig();
    this.ring = new Float32Array(1 << 15);
    this.ringPos = 0;
    this.samplesSinceHop = 0;
    this.dcPrevX = 0;
    this.dcPrevY = 0;
    this.blockRms = new Float32Array(8);
    this.blockEnergy = new Float32Array(8);
    this.blockIdx = 0;
    this.lastOnsetT = -1;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "config") {
        Object.assign(this.config, e.data.profile || {});
        this.applyConfig();
      }
    };
  }

  applyConfig() {
    const sr = sampleRate;
    const c = this.config;
    this.N = Math.max(256, Math.round((c.windowMs / 1000) * sr));
    this.hop = Math.max(128, Math.round((c.hopMs / 1000) * sr));
    this.minLag = Math.max(2, Math.floor(sr / c.fMax));
    this.maxLag = Math.min(Math.floor(this.N / 2) - 2, Math.ceil(sr / c.fMin));
    this.window = new Float32Array(this.N);
    this.scratch = { nsdf: new Float32Array(this.maxLag + 2), maxima: new Float32Array(128) };
    this.gateLin = Math.pow(10, c.gateDb / 20);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const n = ch.length;
    const ring = this.ring;
    const mask = ring.length - 1;
    let sq = 0;
    let px = this.dcPrevX;
    let py = this.dcPrevY;
    for (let i = 0; i < n; i++) {
      const x = ch[i];
      const y = x - px + 0.995 * py;
      px = x;
      py = y;
      ring[(this.ringPos + i) & mask] = y;
      sq += y * y;
    }
    this.dcPrevX = px;
    this.dcPrevY = py;
    this.ringPos = (this.ringPos + n) & mask;
    this.samplesSinceHop += n;

    // A single block is shorter than a low guitar/bass cycle. Smooth power
    // before detecting rises so each cycle does not look like another pluck.
    this.blockEnergy[this.blockIdx] = sq / n;
    let envelopeEnergy = 0;
    for (let i = 0; i < 8; i++) envelopeEnergy += this.blockEnergy[i];
    const rms = Math.sqrt(envelopeEnergy / 8);
    const tBlock = currentTime;
    // Onset: rise over the minimum of the last 8 blocks.
    let minPrev = Infinity;
    for (let i = 0; i < 8; i++) minPrev = Math.min(minPrev, this.blockRms[i]);
    this.blockRms[this.blockIdx] = rms;
    this.blockIdx = (this.blockIdx + 1) & 7;
    const c = this.config;
    if (rms > this.gateLin && minPrev < Infinity) {
      // USB noise gates can produce exact zero. That is a valid quiet baseline,
      // not a reason to discard the first attack after silence.
      const riseDb = 20 * Math.log10(rms / Math.max(minPrev, this.gateLin * 0.1));
      if (riseDb >= c.onsetRiseDb && (this.lastOnsetT < 0 || (tBlock - this.lastOnsetT) * 1000 >= c.refractoryMs)) {
        this.lastOnsetT = tBlock;
        this.port.postMessage({ type: "onset", t: tBlock, strength: Math.min(1, (riseDb - 6) / 34), rms });
      }
    }

    if (this.samplesSinceHop >= this.hop) {
      this.samplesSinceHop -= this.hop;
      const N = this.N;
      const w = this.window;
      let start = (this.ringPos - N) & mask;
      let wsq = 0;
      for (let i = 0; i < N; i++) {
        const v = ring[(start + i) & mask];
        w[i] = v;
        wsq += v * v;
      }
      const wrms = Math.sqrt(wsq / N);
      const db = 20 * Math.log10(wrms + 1e-9);
      let hz = 0;
      let clarity = 0;
      if (wrms > this.gateLin) {
        const r = mpm(w, N, this.minLag, this.maxLag, c.k, this.scratch);
        if (r && r.clarity >= c.clarityThreshold) {
          hz = sampleRate / r.lag;
          clarity = r.clarity;
        } else if (r) {
          clarity = r.clarity;
        }
      }
      this.port.postMessage({ type: "frame", t: tBlock + n / sampleRate, hz, clarity, rms: wrms, db });
    }
    return true;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("pitch-processor", PitchProcessor);
}
