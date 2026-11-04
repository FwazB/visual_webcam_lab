"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuitarPitch } from "./useGuitarPitch";
import type { useSongTransport } from "./useSongTransport";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { createHighwayPattern, HighwayGame } from "@/lib/lesson/noteHighway";

type Transport = ReturnType<typeof useSongTransport>;
interface Run { context: AudioContext | null; preview: boolean; startedAt: number }

/** Owns a scored run; camera landmarks and diagnostic audio never award points. */
export function useHighwaySession(profile: InstrumentProfile, pitch: GuitarPitch, transport: Transport, enabled: boolean,
  onFeedback: (hit: boolean, strength: number) => void) {
  const game = useMemo(() => new HighwayGame(createHighwayPattern(profile)), [profile]);
  const gameRef = useRef<HighwayGame | null>(game);
  const live = useRef({ pitch, transport, enabled, onFeedback });
  useEffect(() => { live.current = { pitch, transport, enabled, onFeedback }; });
  const runRef = useRef<Run | null>(null);
  const attemptRef = useRef(0);
  const pendingStartRef = useRef(false);
  const mountedRef = useRef(true);
  const lockedTestRef = useRef<GuitarPitch["test"]>(null);
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onNote } = pitch;

  const stop = useCallback(() => {
    attemptRef.current++;
    pendingStartRef.current = false;
    runRef.current = null;
    live.current.transport.stop();
    lockedTestRef.current?.setEnabled(true);
    lockedTestRef.current = null;
    if (mountedRef.current) setStarting(false);
  }, []);

  const start = useCallback(async (unscored = false) => {
    const current = live.current;
    if (!current.enabled || !mountedRef.current) return;
    stop();
    if (!unscored && (current.pitch.status !== "running" || current.pitch.context?.state !== "running")) {
      setError("Connect your guitar before starting a scored run.");
      return;
    }
    const attempt = attemptRef.current;
    pendingStartRef.current = true;
    const context = current.pitch.context;
    lockedTestRef.current = current.pitch.test;
    lockedTestRef.current?.setEnabled(false);
    gameRef.current?.reset();
    setPreview(unscored);
    setStarting(true);
    setError(null);
    try {
      await current.transport.start({ silent: unscored });
      const latest = live.current;
      if (!mountedRef.current || attempt !== attemptRef.current) return;
      if (!latest.enabled || latest.pitch.context !== context || document.hidden
        || (!unscored && (latest.pitch.status !== "running" || context?.state !== "running"))) {
        stop();
        return;
      }
      runRef.current = { context, preview: unscored, startedAt: context?.currentTime ?? 0 };
      pendingStartRef.current = false;
      setStarting(false);
    } catch {
      if (mountedRef.current && attempt === attemptRef.current) {
        stop();
        setError("Playback could not start. Enable audio and try again.");
      }
    }
  }, [stop]);

  useEffect(() => {
    gameRef.current = game;
    stop();
  }, [game, stop]);

  useEffect(() => {
    if ((!enabled && (pendingStartRef.current || runRef.current)) || (runRef.current && (!transport.playing || pitch.context !== runRef.current.context
      || (!runRef.current.preview && pitch.status !== "running")))) stop();
  }, [enabled, pitch.context, pitch.status, transport.playing, stop]);

  useEffect(() => onNote(event => {
    const current = live.current, run = runRef.current;
    if (!run || run.preview || !current.enabled || !current.transport.playing
      || current.pitch.status !== "running" || current.pitch.context !== run.context
      || run.context?.state !== "running" || event.t < run.startedAt) return;
    const beat = current.transport.beatsAt(event.t);
    const result = gameRef.current?.onNote(event, beat, current.transport.bpm);
    if (result) current.onFeedback(result.kind === "perfect" || result.kind === "good", event.strength);
  }), [onNote]);

  useEffect(() => {
    if (!enabled || !transport.playing) return;
    let raf = 0;
    const tick = () => {
      const current = live.current, run = runRef.current;
      if (run && !run.preview && current.pitch.context === run.context && current.pitch.status === "running"
        && run.context?.state === "running") gameRef.current?.advance(current.transport.beatsRef.current, current.transport.bpm);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, transport.playing]);

  useEffect(() => {
    mountedRef.current = true;
    const onVisibility = () => { if (document.hidden && (pendingStartRef.current || runRef.current)) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [stop]);

  return { gameRef, starting, preview, error, start, stop };
}
