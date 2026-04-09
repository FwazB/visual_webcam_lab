"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
import type { PoseData } from "./usePoseTracking";

// --- Types ---

export type EffectType = "speed" | "delay" | "pan";

export interface EffectLock {
  locked: boolean;
  value: number;
}

export interface EffectLocks {
  speed: EffectLock;
  delay: EffectLock;
  pan: EffectLock;
}

export interface HandTargets {
  left: EffectType | null;
  right: EffectType | null;
}

export interface AudioParams {
  filterFreq: number;
  reverbWet: number;
  delayWet: number;
  distortion: number;
  pan: number;
  playbackRate: number;
}

const EFFECT_ORDER: EffectType[] = ["speed", "delay", "pan"];
const PINKY_TAP_THRESHOLD = 0.25;
const PINKY_TAP_COOLDOWN_MS = 500;
const SMOOTHING_FACTOR = 0.15;
const HAND_LOSS_DECAY_FRAMES = 30;

// Neutral defaults for each param
const NEUTRAL_PLAYBACK_RATE = 1.0;
const NEUTRAL_DELAY_WET = 0;
const NEUTRAL_PAN = 0;

function effectToParamKey(effect: EffectType): keyof AudioParams {
  switch (effect) {
    case "speed":
      return "playbackRate";
    case "delay":
      return "delayWet";
    case "pan":
      return "pan";
  }
}

function getNextUnlockedEffect(
  locks: EffectLocks,
  excludeTarget: EffectType | null
): EffectType | null {
  for (const effect of EFFECT_ORDER) {
    if (!locks[effect].locked && effect !== excludeTarget) {
      return effect;
    }
  }
  return null;
}

function computeEffectValue(
  effect: EffectType,
  pinch: number,
  handX: number
): number {
  switch (effect) {
    case "speed":
      return 0.5 + pinch * 1.5;
    case "delay":
      return pinch * 0.6;
    case "pan":
      return (1 - handX) * 2 - 1; // mirrored webcam
  }
}

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

const DEFAULT_LOCKS: EffectLocks = {
  speed: { locked: false, value: 1 },
  delay: { locked: false, value: 0 },
  pan: { locked: false, value: 0 },
};

const DEFAULT_TARGETS: HandTargets = {
  left: "speed",
  right: "delay",
};

export function useAudioEngine() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [audioParams, setAudioParams] = useState<AudioParams>({
    filterFreq: 2000,
    reverbWet: 0,
    delayWet: 0,
    distortion: 0,
    pan: 0,
    playbackRate: 1,
  });
  const [locks, setLocks] = useState<EffectLocks>({ ...DEFAULT_LOCKS });
  const [handTargets, setHandTargets] = useState<HandTargets>({
    ...DEFAULT_TARGETS,
  });

  // Tone.js node refs (only nodes actually in the signal chain)
  const playerRef = useRef<Tone.Player | null>(null);
  const delayRef = useRef<Tone.FeedbackDelay | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const analyserRef = useRef<Tone.Analyser | null>(null);

  // Real-time refs (updated every frame, no re-renders)
  const audioParamsRef = useRef<AudioParams>(audioParams);
  const lastParamsUpdateRef = useRef<number>(0);
  const locksRef = useRef<EffectLocks>({ ...DEFAULT_LOCKS });
  const handTargetsRef = useRef<HandTargets>({ ...DEFAULT_TARGETS });

  // Edge-detection refs for throw gesture
  const prevLeftThrowRef = useRef(false);
  const prevRightThrowRef = useRef(false);
  const prevLeftPinkyDownRef = useRef(false);
  const prevRightPinkyDownRef = useRef(false);

  // Issue 1: Smoothed param refs for exponential smoothing
  const smoothedPlaybackRateRef = useRef(NEUTRAL_PLAYBACK_RATE);
  const smoothedDelayWetRef = useRef(NEUTRAL_DELAY_WET);
  const smoothedPanRef = useRef(NEUTRAL_PAN);

  // Issue 3: Hand loss decay refs
  const handLossDecayRef = useRef(0);
  const lastKnownPlaybackRateRef = useRef(NEUTRAL_PLAYBACK_RATE);
  const lastKnownDelayWetRef = useRef(NEUTRAL_DELAY_WET);
  const lastKnownPanRef = useRef(NEUTRAL_PAN);
  const prevHandsVisibleRef = useRef(false);

  // Issue 5: Pinky tap cooldown timestamps
  const lastLeftPinkyTapRef = useRef(0);
  const lastRightPinkyTapRef = useRef(0);


  // Initialize the audio chain
  const loadTrack = useCallback(async (url: string) => {
    // Issue 10: Reset playback state and stop current playback
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current.dispose();
    }
    setIsPlaying(false);

    [delayRef, pannerRef, analyserRef].forEach((ref) => {
      if (ref.current) {
        (ref.current as Tone.ToneAudioNode).dispose();
        ref.current = null;
      }
    });

    const player = new Tone.Player({ url, loop: true });
    const analyser = new Tone.Analyser("waveform", 256);
    const delay = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.3,
      wet: 0,
    });
    const panner = new Tone.Panner(0);
    player.chain(delay, panner, analyser, Tone.getDestination());

    // Issue 8: Removed unused filter, reverb, distortion nodes

    playerRef.current = player;
    delayRef.current = delay;
    pannerRef.current = panner;
    analyserRef.current = analyser;

    await Tone.loaded();
    setIsLoaded(true);
  }, []);

  const togglePlayback = useCallback(async () => {
    if (!playerRef.current || !isLoaded) return;
    await Tone.start();
    if (isPlaying) {
      playerRef.current.stop();
      setIsPlaying(false);
    } else {
      playerRef.current.start();
      setIsPlaying(true);
    }
  }, [isPlaying, isLoaded]);

  // --- Core: map pose → per-effect locks → audio ---
  const updateFromPose = useCallback((pose: PoseData) => {
    let curLocks = locksRef.current;
    let curTargets = handTargetsRef.current;
    let locksChanged = false;
    let targetsChanged = false;

    // ── Per-hand throw-to-lock ──
    // Detect rising edge of throw gesture to trigger locks.
    {
      const leftIn = pose.leftHandThrow;
      const rightIn = pose.rightHandThrow;
      const leftEntered = leftIn && !prevLeftThrowRef.current;
      const rightEntered = rightIn && !prevRightThrowRef.current;

      // If both hands enter simultaneously and all are locked, reset
      if (leftEntered && rightEntered &&
          curLocks.speed.locked && curLocks.delay.locked && curLocks.pan.locked) {
        curLocks = { ...DEFAULT_LOCKS };
        curTargets = { ...DEFAULT_TARGETS };
        locksChanged = true;
        targetsChanged = true;
      } else {
        // Left hand entered save zone
        if (leftEntered) {
          const target = curTargets.left;
          if (target && !curLocks[target].locked) {
            curLocks = {
              ...curLocks,
              [target]: {
                locked: true,
                value: audioParamsRef.current[effectToParamKey(target)],
              },
            };
            locksChanged = true;
          } else if (curLocks.speed.locked && curLocks.delay.locked && curLocks.pan.locked) {
            curLocks = { ...DEFAULT_LOCKS };
            curTargets = { ...DEFAULT_TARGETS };
            locksChanged = true;
            targetsChanged = true;
          }
        }

        // Right hand entered save zone
        if (rightEntered) {
          const target = curTargets.right;
          if (target && !curLocks[target].locked) {
            curLocks = {
              ...curLocks,
              [target]: {
                locked: true,
                value: audioParamsRef.current[effectToParamKey(target)],
              },
            };
            locksChanged = true;
          } else if (curLocks.speed.locked && curLocks.delay.locked && curLocks.pan.locked) {
            curLocks = { ...DEFAULT_LOCKS };
            curTargets = { ...DEFAULT_TARGETS };
            locksChanged = true;
            targetsChanged = true;
          }
        }

        // Re-target both hands after all locks are applied
        if (locksChanged) {
          if (leftEntered || !curTargets.left || curLocks[curTargets.left]?.locked) {
            const nextLeft = getNextUnlockedEffect(curLocks, curTargets.right);
            if (nextLeft !== curTargets.left) {
              curTargets = { ...curTargets, left: nextLeft };
              targetsChanged = true;
            }
          }
          if (rightEntered || !curTargets.right || curLocks[curTargets.right]?.locked) {
            const nextRight = getNextUnlockedEffect(curLocks, curTargets.left);
            if (nextRight !== curTargets.right) {
              curTargets = { ...curTargets, right: nextRight };
              targetsChanged = true;
            }
          }
        }
      }

      prevLeftThrowRef.current = leftIn;
      prevRightThrowRef.current = rightIn;
    }

    // ── Pinky tap: cycle targeted effect ──
    // Issue 5: Added cooldown to prevent rapid-fire cycling
    {
      const now = performance.now();
      const leftPinkyDown = pose.leftPinkyTap < PINKY_TAP_THRESHOLD;
      const rightPinkyDown = pose.rightPinkyTap < PINKY_TAP_THRESHOLD;

      // Left pinky released → cycle (with cooldown)
      if (!leftPinkyDown && prevLeftPinkyDownRef.current &&
          now - lastLeftPinkyTapRef.current > PINKY_TAP_COOLDOWN_MS) {
        const available = EFFECT_ORDER.filter(
          (e) => !curLocks[e].locked && e !== curTargets.right
        );
        if (available.length > 1 && curTargets.left) {
          const idx = available.indexOf(curTargets.left);
          const next = available[(idx + 1) % available.length];
          curTargets = { ...curTargets, left: next };
          targetsChanged = true;
          lastLeftPinkyTapRef.current = now;
        }
      }

      // Right pinky released → cycle (with cooldown)
      if (!rightPinkyDown && prevRightPinkyDownRef.current &&
          now - lastRightPinkyTapRef.current > PINKY_TAP_COOLDOWN_MS) {
        const available = EFFECT_ORDER.filter(
          (e) => !curLocks[e].locked && e !== curTargets.left
        );
        if (available.length > 1 && curTargets.right) {
          const idx = available.indexOf(curTargets.right);
          const next = available[(idx + 1) % available.length];
          curTargets = { ...curTargets, right: next };
          targetsChanged = true;
          lastRightPinkyTapRef.current = now;
        }
      }

      prevLeftPinkyDownRef.current = leftPinkyDown;
      prevRightPinkyDownRef.current = rightPinkyDown;
    }

    // ── Commit state changes ──
    if (locksChanged) {
      locksRef.current = curLocks;
      setLocks({ ...curLocks });
    }
    if (targetsChanged) {
      handTargetsRef.current = curTargets;
      setHandTargets({ ...curTargets });
    }

    // ── Compute final effect values ──
    const filterFreq = 2000;
    const reverbWet = 0;
    const distortion = 0;

    // Start from locked values or neutral defaults
    let playbackRate = curLocks.speed.locked ? curLocks.speed.value : NEUTRAL_PLAYBACK_RATE;
    let delayWet = curLocks.delay.locked ? curLocks.delay.value : NEUTRAL_DELAY_WET;
    let pan = curLocks.pan.locked ? curLocks.pan.value : NEUTRAL_PAN;

    if (pose.handsVisible) {
      // Issue 3: Hands are visible — reset decay counter
      handLossDecayRef.current = 0;

      const leftHandX = pose.leftHandX;
      const rightHandX = pose.rightHandX;

      // Left hand drives its targeted effect
      if (curTargets.left && !curLocks[curTargets.left].locked) {
        const val = computeEffectValue(
          curTargets.left,
          pose.leftPinch,
          leftHandX
        );
        switch (curTargets.left) {
          case "speed":
            playbackRate = val;
            break;
          case "delay":
            delayWet = val;
            break;
          case "pan":
            pan = val;
            break;
        }
      }

      // Right hand drives its targeted effect
      if (curTargets.right && !curLocks[curTargets.right].locked) {
        const val = computeEffectValue(
          curTargets.right,
          pose.rightPinch,
          rightHandX
        );
        switch (curTargets.right) {
          case "speed":
            playbackRate = val;
            break;
          case "delay":
            delayWet = val;
            break;
          case "pan":
            pan = val;
            break;
        }
      }

      // Issue 6: Removed pan fallback — pan only updates when explicitly targeted
      // (or when locked at a value). No more always-on handX tracking.

      // Store last known values for hand loss fade
      lastKnownPlaybackRateRef.current = playbackRate;
      lastKnownDelayWetRef.current = delayWet;
      lastKnownPanRef.current = pan;
    } else {
      // Issue 3: Hands lost — fade from last known values toward neutral
      if (prevHandsVisibleRef.current) {
        // Just lost hands this frame — start decay
        handLossDecayRef.current = 0;
      }

      if (handLossDecayRef.current < HAND_LOSS_DECAY_FRAMES) {
        handLossDecayRef.current++;
        const t = handLossDecayRef.current / HAND_LOSS_DECAY_FRAMES;
        if (!curLocks.speed.locked) {
          playbackRate = lastKnownPlaybackRateRef.current + (NEUTRAL_PLAYBACK_RATE - lastKnownPlaybackRateRef.current) * t;
        }
        if (!curLocks.delay.locked) {
          delayWet = lastKnownDelayWetRef.current + (NEUTRAL_DELAY_WET - lastKnownDelayWetRef.current) * t;
        }
        if (!curLocks.pan.locked) {
          pan = lastKnownPanRef.current + (NEUTRAL_PAN - lastKnownPanRef.current) * t;
        }
      }
      // After decay completes, values stay at neutral (the defaults set above)
    }

    prevHandsVisibleRef.current = pose.handsVisible;

    // ── Issue 1: Apply exponential smoothing before setting audio nodes ──
    smoothedPlaybackRateRef.current = lerp(smoothedPlaybackRateRef.current, playbackRate, SMOOTHING_FACTOR);
    smoothedDelayWetRef.current = lerp(smoothedDelayWetRef.current, delayWet, SMOOTHING_FACTOR);
    smoothedPanRef.current = lerp(smoothedPanRef.current, pan, SMOOTHING_FACTOR);

    const smoothedPan = Math.max(-1, Math.min(1, smoothedPanRef.current));

    // ── Apply smoothed values to Tone.js nodes ──
    if (playerRef.current) playerRef.current.playbackRate = smoothedPlaybackRateRef.current;
    if (delayRef.current) delayRef.current.wet.value = smoothedDelayWetRef.current;
    if (pannerRef.current) pannerRef.current.pan.value = smoothedPan;

    // ── Update param refs + throttled React state ──
    audioParamsRef.current = {
      filterFreq,
      reverbWet,
      delayWet: smoothedDelayWetRef.current,
      distortion,
      pan: smoothedPan,
      playbackRate: smoothedPlaybackRateRef.current,
    };
    const now = performance.now();
    if (now - lastParamsUpdateRef.current > 100) {
      lastParamsUpdateRef.current = now;
      setAudioParams(audioParamsRef.current);
    }
  }, []);

  const resetLocks = useCallback(() => {
    locksRef.current = { ...DEFAULT_LOCKS };
    handTargetsRef.current = { ...DEFAULT_TARGETS };
    setLocks({ ...DEFAULT_LOCKS });
    setHandTargets({ ...DEFAULT_TARGETS });
    prevLeftThrowRef.current = false;
    prevRightThrowRef.current = false;
    prevLeftPinkyDownRef.current = false;
    prevRightPinkyDownRef.current = false;
  }, []);

  const getWaveformData = useCallback((): Float32Array => {
    if (analyserRef.current) {
      return analyserRef.current.getValue() as Float32Array;
    }
    return new Float32Array(256);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      playerRef.current?.dispose();
      delayRef.current?.dispose();
      pannerRef.current?.dispose();
      analyserRef.current?.dispose();
    };
  }, []);

  return {
    isPlaying,
    isLoaded,
    locks,
    handTargets,
    audioParams,
    loadTrack,
    togglePlayback,
    updateFromPose,
    resetLocks,
    getWaveformData,
  };
}
