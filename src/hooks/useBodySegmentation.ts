"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_URL } from "@/lib/mediapipe";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export function useBodySegmentation(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const segmenterRef = useRef<ImageSegmenter | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const maskRef = useRef<Float32Array | null>(null);
  const maskSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(-1);
  const mountedRef = useRef(false);
  const runningRef = useRef(false);
  const generationRef = useRef(0);

  const stopSegmentation = useCallback(() => {
    runningRef.current = false;
    generationRef.current++;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    lastTimeRef.current = -1;
    maskRef.current = null;
    maskSizeRef.current = { width: 0, height: 0 };
  }, []);

  // Initialize segmenter
  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        if (cancelled) return;

        const segmenter = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });

        if (cancelled) {
          segmenter.close();
          return;
        }

        segmenterRef.current = segmenter;
      } catch {
        // Without a mask the ASCII view still renders the whole frame.
        if (!cancelled) stopSegmentation();
      }
      if (!cancelled) setIsLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      stopSegmentation();
      const segmenter = segmenterRef.current;
      segmenterRef.current = null;
      try { segmenter?.close(); } catch { /* GPU resources may already be unavailable. */ }
    };
  }, [stopSegmentation]);

  // Run segmentation loop
  const startSegmentation = useCallback(() => {
    if (!mountedRef.current || !segmenterRef.current || runningRef.current) return stopSegmentation;
    runningRef.current = true;
    const generation = ++generationRef.current;

    function tick() {
      if (!mountedRef.current || !runningRef.current || generation !== generationRef.current) return;
      rafRef.current = 0;
      const video = videoRef.current;
      const segmenter = segmenterRef.current;

      if (!video || !segmenter || video.readyState < 2 || video.paused || video.ended) {
        maskRef.current = null;
        maskSizeRef.current = { width: 0, height: 0 };
        lastTimeRef.current = -1;
      } else if (video.currentTime !== lastTimeRef.current) {
        lastTimeRef.current = video.currentTime;
        const timestamp = performance.now();

        try {
          segmenter.segmentForVideo(video, timestamp, (result) => {
            if (!runningRef.current || generation !== generationRef.current) return;
            const mask = result.confidenceMasks?.[0];
            // Callback results belong to MediaPipe and expire when it returns.
            // The ASCII renderer reads later, so retain our own array only.
            maskRef.current = mask ? new Float32Array(mask.getAsFloat32Array()) : null;
            maskSizeRef.current = mask ? { width: mask.width, height: mask.height } : { width: 0, height: 0 };
          });
        } catch {
          stopSegmentation();
          return;
        }
      }

      if (runningRef.current && generation === generationRef.current) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return stopSegmentation;
  }, [videoRef, stopSegmentation]);

  return {
    isLoading,
    maskRef,
    maskSizeRef,
    startSegmentation,
    stopSegmentation,
  };
}
