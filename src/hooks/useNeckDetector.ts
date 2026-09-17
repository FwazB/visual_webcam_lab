"use client";

// Runs the neck detector against a video element on a timer, feeds the
// tracker, and exposes refs for the render loop plus a control API.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { detectNeck } from "@/lib/neck/detect";
import { handPrior, selectFrettingHand, type TrackedHand } from "@/lib/neck/fretHand";
import {
  applyDeltaK,
  coastNeckTrack,
  createTrackState,
  flipNeckOrientation,
  flipNeckStrings,
  lockNeck,
  resetNeck,
  updateNeckTrack,
  type NeckTrackState,
} from "@/lib/neck/track";
import type { NeckObservation, NeckTrackStatus, RgbaFrame } from "@/lib/neck/types";

export interface NeckDetectorOptions {
  profile: InstrumentProfile;
  /** Returns the current hands (from usePoseTracking) at tick time. */
  getHands: () => TrackedHand[];
  enabled?: boolean;
  swapHands?: boolean;
}

export interface NeckDetector {
  stateRef: React.RefObject<NeckTrackState>;
  status: NeckTrackStatus;
  driftWarning: boolean;
  lastObsRef: React.RefObject<NeckObservation | null>;
  debugRef: React.RefObject<Record<string, unknown>>;
  frameSizeRef: React.RefObject<{ width: number; height: number }>;
  lock: (locked: boolean) => void;
  nudge: (delta: number) => void;
  flipOrientation: () => void;
  flipStrings: () => void;
  reset: () => void;
  /** Run one detection immediately (e.g. on a paused frame). */
  detectNow: () => void;
}

function intervalFor(status: NeckTrackStatus): number {
  switch (status) {
    case "locked":
      return 1000;
    case "tracking":
      return 200;
    default:
      return 100;
  }
}

export function useNeckDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  opts: NeckDetectorOptions,
): NeckDetector {
  const stateRef = useRef<NeckTrackState>(createTrackState());
  const lastObsRef = useRef<NeckObservation | null>(null);
  const debugRef = useRef<Record<string, unknown>>({});
  const frameSizeRef = useRef({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<NeckTrackStatus>("searching");
  const [driftWarning, setDriftWarning] = useState(false);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const [version, setVersion] = useState(0);

  const grabFrame = useCallback((): RgbaFrame | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    frameSizeRef.current = { width: img.width, height: img.height };
    return { data: img.data, width: img.width, height: img.height };
  }, [videoRef]);

  const runOnce = useCallback(() => {
    const frame = grabFrame();
    const state = stateRef.current;
    const now = performance.now();
    if (!frame) {
      coastNeckTrack(state, now);
      setStatus(state.status);
      return;
    }
    const { profile, getHands, swapHands } = optsRef.current;
    const hand = selectFrettingHand(getHands(), frame.width, frame.height, state.model, swapHands);
    const prior = hand ? handPrior(hand, frame.width, frame.height) : null;
    const debug: Record<string, unknown> = {};
    const obs = detectNeck(frame, {
      profile,
      hand: prior,
      prevModel: state.model,
      orientationPreference: state.orientationPreference,
      flipStrings: state.flipStrings,
      now,
      debug,
    });
    lastObsRef.current = obs;
    debugRef.current = debug;
    updateNeckTrack(state, obs, now);
    setStatus(state.status);
    setDriftWarning(state.driftWarning);
  }, [grabFrame]);

  useEffect(() => {
    if (opts.enabled === false) return;
    let timer = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        runOnce();
      } catch (err) {
        console.error("neck detector error", err);
      }
      timer = window.setTimeout(tick, intervalFor(stateRef.current.status));
    };
    timer = window.setTimeout(tick, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runOnce, opts.enabled, version]);

  const bump = () => setVersion((v) => v + 1);

  return useMemo<NeckDetector>(
    () => ({
      stateRef,
      status,
      driftWarning,
      lastObsRef,
      debugRef,
      frameSizeRef,
      lock: (locked) => {
        lockNeck(stateRef.current, locked);
        setStatus(stateRef.current.status);
        bump();
      },
      nudge: (delta) => applyDeltaK(stateRef.current, delta),
      flipOrientation: () => {
        flipNeckOrientation(stateRef.current);
        setStatus(stateRef.current.status);
      },
      flipStrings: () => flipNeckStrings(stateRef.current),
      reset: () => {
        resetNeck(stateRef.current);
        setStatus(stateRef.current.status);
      },
      detectNow: runOnce,
    }),
    [status, driftWarning, runOnce],
  );
}
