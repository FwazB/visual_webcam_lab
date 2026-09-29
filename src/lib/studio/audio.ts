// Audio data helpers for the studio: 16-bit PCM WAV encoding and waveform
// peaks for drawing clips.

/** Encode channels as a 16-bit PCM WAV file (interleaved). */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const channelCount = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerFrame = channelCount * 2;
  const dataBytes = frames * bytesPerFrame;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return buffer;
}

/** Peak amplitude per bucket across all channels. */
export function computePeaks(channels: Float32Array[], sampleRate: number, bucketsPerSecond = 200): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const size = Math.max(1, Math.floor(sampleRate / bucketsPerSecond));
  const peaks = new Float32Array(Math.ceil(frames / size));
  for (const ch of channels) {
    for (let b = 0; b < peaks.length; b++) {
      let max = peaks[b];
      const end = Math.min(frames, (b + 1) * size);
      for (let i = b * size; i < end; i++) {
        const v = Math.abs(ch[i]);
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  return peaks;
}

export const PEAKS_PER_SECOND = 200;

export function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

/** Build an AudioBuffer without a context (the constructor needs none). */
export function toAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const buffer = new AudioBuffer({ numberOfChannels: channels.length, length: Math.max(1, channels[0]?.length ?? 1), sampleRate });
  channels.forEach((ch, c) => buffer.getChannelData(c).set(ch));
  return buffer;
}
