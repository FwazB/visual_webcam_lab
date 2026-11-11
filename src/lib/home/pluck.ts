// Karplus–Strong plucked-string synthesis for the homepage's optional sound.

/**
 * Render a plucked note: a noise burst circulating through a delay line of
 * one period with a two-point averaging low-pass. `random` is injectable so
 * tests are deterministic.
 */
export function karplusStrong(
  hz: number,
  sampleRate: number,
  seconds = 2,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(Math.round(sampleRate * seconds) * 4));
  const period = Math.max(2, Math.round(sampleRate / hz));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = random() * 2 - 1;
  // Slightly under 0.5 per tap so low strings still fade within the buffer.
  const damping = 0.996;
  let idx = 0;
  for (let i = 0; i < out.length; i++) {
    const next = (idx + 1) % period;
    const value = line[idx];
    out[i] = value;
    line[idx] = damping * 0.5 * (value + line[next]);
    idx = next;
  }
  // Short fade-out so the buffer never ends on a click.
  const fade = Math.min(out.length, Math.round(sampleRate * 0.05));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

/** Soft-saturated low string with a short, airy harmonic tail. */
export function cloudString(hz: number, sampleRate: number, seconds = 2.5, random: () => number = Math.random): Float32Array<ArrayBuffer> {
  const out = karplusStrong(hz, sampleRate, seconds, random);
  const fade = Math.max(1, Math.round(sampleRate * 0.08));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * hz * t;
    const body = Math.sin(phase) + 0.24 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 3);
    const envelope = Math.min(1, i / (sampleRate * 0.008)) * Math.exp(-2.2 * t);
    const tail = Math.min(1, (out.length - 1 - i) / fade);
    out[i] = Math.tanh(out[i] * 2 + body * 0.6) * envelope * tail * 0.8;
  }
  return out;
}
