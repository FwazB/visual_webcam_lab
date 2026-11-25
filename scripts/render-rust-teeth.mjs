// Run with Node 24 to regenerate the guitar backing loop from the guide's score.
import { writeFile } from "node:fs/promises";
import score from "../src/app/pocket-operators/rhythm/rust-teeth.json" with { type: "json" };
import { encodeWav } from "../src/lib/studio/audio.ts";

const sampleRate = 32000;
const samplesPerStep = sampleRate * 60 / score.bpm / 4;
const mix = new Float32Array(Math.round(score.chain.length * 16 * samplesPerStep));
const tau = 2 * Math.PI;
let seed = 120033;

function noise() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x80000000 - 1;
}

// A falling drum head, with a little saturated second harmonic for small speakers.
function membrane(time, base, drop, sweep, decay) {
  const phase = tau * (base * time + drop * sweep * (1 - Math.exp(-time / sweep)));
  return Math.exp(-time / decay) * Math.tanh(1.45 * Math.sin(phase) + 0.28 * Math.sin(2 * phase));
}

function renderHit(sound, step, start) {
  let previousNoise = 0;
  const length = Math.round(sampleRate * (sound === 3 ? 0.14 : 0.46));
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const white = noise();
    const bright = white - previousNoise;
    previousNoise = white;
    let value;
    switch (sound) {
      case 1:
        value = 0.92 * membrane(t, 49, 112, 0.022, 0.104) + 0.09 * bright * Math.exp(-t / 0.005);
        break;
      case 2: {
        const snare = 0.48 * membrane(t, 174, 60, 0.012, 0.063) + 0.51 * white * Math.exp(-t / 0.077);
        value = step === 16 ? snare * 0.68 : snare;
        break;
      }
      case 3:
        value = (step === 14 ? 0.065 : 0.115) * bright * Math.exp(-t / 0.023);
        break;
      case 11:
        value = 0.66 * membrane(t, 83, 66, 0.05, 0.106);
        break;
      default:
        throw new Error(`Missing demo voice for PO-12 sound ${sound}`);
    }
    const envelope = Math.min(1, i / 24, (length - 1 - i) / 160);
    // Carry the last snare's tail across the loop boundary.
    mix[(start + i) % mix.length] += value * envelope;
  }
}

for (const [bar, pattern] of score.chain.entries()) {
  for (const part of score.parts) {
    for (const step of part[pattern]) {
      renderHit(part.sound, step, Math.round((bar * 16 + step - 1) * samplesPerStep));
    }
  }
}

for (let i = 0; i < mix.length; i++) mix[i] = 0.85 * Math.tanh(1.55 * mix[i]);
const destination = new URL("../public/audio/rust-teeth.wav", import.meta.url);
await writeFile(destination, new Uint8Array(encodeWav([mix], sampleRate)));
