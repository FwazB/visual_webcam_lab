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

  // Initialize segmenter
  useEffect(() => {
    let cancelled = false;

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
      }
      if (!cancelled) setIsLoading(false);
    }

    init();

    return () => {
      cancelled = true;
      segmenterRef.current?.close();
      segmenterRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Run segmentation loop
  const startSegmentation = useCallback(() => {
    function tick() {
      const video = videoRef.current;
      const segmenter = segmenterRef.current;

      if (
        video &&
        segmenter &&
        video.readyState >= 2 &&
        video.currentTime !== lastTimeRef.current
      ) {
        lastTimeRef.current = video.currentTime;
        const timestamp = performance.now();

        segmenter.segmentForVideo(video, timestamp, (result) => {
          if (result.confidenceMasks && result.confidenceMasks.length > 0) {
            const mask = result.confidenceMasks[0];
            maskRef.current = mask.getAsFloat32Array();
            maskSizeRef.current = {
              width: mask.width,
              height: mask.height,
            };
          }
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [videoRef]);

  return {
    isLoading,
    maskRef,
    maskSizeRef,
    startSegmentation,
  };
}
