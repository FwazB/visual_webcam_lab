"use client";

import { useEffect, useRef, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_WASM_URL } from "@/lib/mediapipe";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandDetection {
  landmarks: NormalizedLandmark[];
  /** MediaPipe handedness label ("Left" | "Right"), camera perspective. */
  label: string;
  score: number;
}

/** Landmark indices of the index, middle, ring and pinky fingertips. */
export const FINGERTIPS = [8, 12, 16, 20] as const;

export function useHandTracking(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const handsRef = useRef<HandDetection[]>([]);

  useEffect(() => {
    let cancelled = false;
    let detector: HandLandmarker | null = null;

    const release = () => {
      const owned = detector;
      detector = null;
      if (handLandmarkerRef.current === owned) handLandmarkerRef.current = null;
      try {
        owned?.close();
      } catch {
        // A lost GPU context may already have disposed its resources.
      }
    };

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        if (cancelled) return;

        detector = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) {
          release();
          return;
        }

        handLandmarkerRef.current = detector;
        setIsLoading(false);
      } catch {
        release();
        if (cancelled) return;
        setError("Hand tracking could not start. Reload to retry; audio practice still works.");
        setIsLoading(false);
      }
    }

    init();

    return () => {
      cancelled = true;
      release();
    };
  }, []);

  useEffect(() => {
    if (isLoading || error) return;
    let rafId = 0;

    function detect() {
      const video = videoRef.current;
      const handLandmarker = handLandmarkerRef.current;
      if (video && handLandmarker && video.readyState >= 2) {
        const result = handLandmarker.detectForVideo(video, performance.now());
        handsRef.current = result.landmarks.map((landmarks, i) => ({
          landmarks,
          label: result.handednesses?.[i]?.[0]?.categoryName ?? "Right",
          score: result.handednesses?.[i]?.[0]?.score ?? 0,
        }));
      }
      rafId = requestAnimationFrame(detect);
    }

    rafId = requestAnimationFrame(detect);
    return () => cancelAnimationFrame(rafId);
  }, [isLoading, error, videoRef]);

  return { handsRef, isLoading, error };
}
