"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

export interface ToneProfile {
  low: number;
  mid: number;
  high: number;
  depth: number;
}

interface AudioReactiveInput {
  isListening: boolean;
  error: string | null;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  toneRef: MutableRefObject<ToneProfile>;
  start: () => Promise<void>;
  stop: () => void;
}

const SILENT_TONE: ToneProfile = {
  low: 0,
  mid: 0,
  high: 0,
  depth: 0,
};

function bandAverage(
  data: Uint8Array,
  sampleRate: number,
  minHz: number,
  maxHz: number,
): number {
  const nyquist = sampleRate / 2;
  const start = Math.max(0, Math.floor((minHz / nyquist) * data.length));
  const end = Math.min(data.length - 1, Math.ceil((maxHz / nyquist) * data.length));
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i <= end; i++) {
    sum += data[i] / 255;
  }

  return sum / (end - start + 1);
}

export function useAudioReactiveInput(): AudioReactiveInput {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const levelRef = useRef(0);
  const peakRef = useRef(0);
  const toneRef = useRef<ToneProfile>({ ...SILENT_TONE });

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    levelRef.current = 0;
    peakRef.current = 0;
    toneRef.current = { ...SILENT_TONE };
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Web Audio is not supported in this browser");
      }
      const audioCtx = new AudioContextCtor();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      const frequencies = new Uint8Array(analyser.frequencyBinCount);
      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      setIsListening(true);

      const read = () => {
        analyser.getByteTimeDomainData(samples);
        analyser.getByteFrequencyData(frequencies);

        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const centered = (samples[i] - 128) / 128;
          sum += centered * centered;
        }

        const rms = Math.sqrt(sum / samples.length);
        const normalized = Math.min(1, rms * 5.5);
        const prev = levelRef.current;
        const attack = 0.38;
        const release = 0.08;
        const alpha = normalized > prev ? attack : release;

        levelRef.current = prev + (normalized - prev) * alpha;
        peakRef.current = Math.max(levelRef.current, peakRef.current * 0.9);

        // Bass guitar color mapping:
        // low = fundamental/body, mid = growl, high = pick/finger attack.
        const low = bandAverage(frequencies, audioCtx.sampleRate, 35, 180);
        const mid = bandAverage(frequencies, audioCtx.sampleRate, 180, 900);
        const high = bandAverage(frequencies, audioCtx.sampleRate, 900, 4200);
        const total = low + mid + high + 0.0001;
        const nextTone: ToneProfile = {
          low,
          mid,
          high,
          depth: Math.max(0, Math.min(1, low / total)),
        };
        const tonePrev = toneRef.current;
        const toneAlpha = normalized > prev ? 0.24 : 0.1;
        toneRef.current = {
          low: tonePrev.low + (nextTone.low - tonePrev.low) * toneAlpha,
          mid: tonePrev.mid + (nextTone.mid - tonePrev.mid) * toneAlpha,
          high: tonePrev.high + (nextTone.high - tonePrev.high) * toneAlpha,
          depth: tonePrev.depth + (nextTone.depth - tonePrev.depth) * toneAlpha,
        };

        rafRef.current = requestAnimationFrame(read);
      };

      read();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio input");
      stop();
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { isListening, error, levelRef, peakRef, toneRef, start, stop };
}
