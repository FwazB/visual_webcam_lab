"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

interface AudioReactiveInput {
  isListening: boolean;
  error: string | null;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  start: () => Promise<void>;
  stop: () => void;
}

export function useAudioReactiveInput(): AudioReactiveInput {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const levelRef = useRef(0);
  const peakRef = useRef(0);

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
      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      setIsListening(true);

      const read = () => {
        analyser.getByteTimeDomainData(samples);

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
        rafRef.current = requestAnimationFrame(read);
      };

      read();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio input");
      stop();
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { isListening, error, levelRef, peakRef, start, stop };
}
