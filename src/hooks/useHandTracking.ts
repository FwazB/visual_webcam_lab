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
  /** Raw model coordinates from the unmirrored input video. */
  landmarks: NormalizedLandmark[];
  /** MediaPipe handedness classification for the unmirrored input video. */
  label: string;
  /** Handedness classification score, not finger-position or contact confidence. */
  score: number;
}

/** Landmark indices of the index, middle, ring and pinky fingertips. */
export const FINGERTIPS = [8, 12, 16, 20] as const;

const MAX_OBSERVATION_AGE_MS = 250;

export function useHandTracking(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const handsRef = useRef<HandDetection[]>([]);
  /** Observation time before inference on performance.now(); -Infinity when unavailable. */
  const handsUpdatedAtRef = useRef(-Infinity);

  useEffect(() => {
    let cancelled = false;
    let detector: HandLandmarker | null = null;

    const release = () => {
      const owned = detector;
      detector = null;
      if (handLandmarkerRef.current === owned) {
        handLandmarkerRef.current = null;
        handsRef.current = [];
        handsUpdatedAtRef.current = -Infinity;
      }
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
    let stopped = false;
    let lastVideo: HTMLVideoElement | null = null;
    let lastSource: HTMLVideoElement["srcObject"] = null;
    let lastVideoTime = -Infinity;

    function clearHands() {
      handsRef.current = [];
      handsUpdatedAtRef.current = -Infinity;
    }

    function detect() {
      if (stopped) return;
      const video = videoRef.current;
      const handLandmarker = handLandmarkerRef.current;
      const now = performance.now();
      if (video && (video !== lastVideo || video.srcObject !== lastSource)) {
        clearHands();
        lastVideo = video;
        lastSource = video.srcObject;
        lastVideoTime = -Infinity;
      }
      const source = video?.srcObject;
      const sourceStopped = source && "getVideoTracks" in source
        && !source.getVideoTracks().some((track) => track.readyState === "live" && track.enabled && !track.muted);
      if (!video || !handLandmarker || video.readyState < 2 || video.paused || video.ended
        || !video.videoWidth || !video.videoHeight || !Number.isFinite(video.currentTime) || sourceStopped) {
        clearHands();
      } else if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          // A slow synchronous model must not make an old frame appear fresh.
          const observedAt = performance.now();
          const result = handLandmarker.detectForVideo(video, observedAt);
          handsRef.current = result.landmarks.map((landmarks, i) => ({
            landmarks,
            label: result.handednesses?.[i]?.[0]?.categoryName ?? "Unknown",
            score: result.handednesses?.[i]?.[0]?.score ?? 0,
          }));
          handsUpdatedAtRef.current = observedAt;
        } catch {
          clearHands();
          stopped = true;
          setError("Hand tracking stopped. Reload to retry; audio practice still works.");
          return;
        }
      } else if (now - handsUpdatedAtRef.current > MAX_OBSERVATION_AGE_MS) {
        clearHands();
      }
      rafId = requestAnimationFrame(detect);
    }

    rafId = requestAnimationFrame(detect);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      clearHands();
    };
  }, [isLoading, error, videoRef]);

  return { handsRef, handsUpdatedAtRef, isLoading, error };
}
