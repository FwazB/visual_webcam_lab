"use client";

// Song transport on Tone.js: metronome, optional backing (kick, hats, bass
// root), count-in, and a beat clock aligned with the pitch AudioContext.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import type { SongChart } from "@/lib/lesson/songs";
import { chartPositionAt } from "@/lib/lesson/songPlayer";
import { BeatClock } from "@/lib/lesson/beatClock";

export interface SongTransport {
  playing: boolean;
  bpm: number;
  setBpm: (bpm: number) => void;
  countInBars: number;
  metronome: boolean;
  backing: boolean;
  setMetronome: (on: boolean) => void;
  setBacking: (on: boolean) => void;
  /** Must be called from a user gesture. */
  start: () => Promise<void>;
  stop: () => void;
  /** Beats since the chart started (negative during count-in). */
  beatsRef: React.RefObject<number>;
  /** Chart beats at a given AudioContext time (same clock as NoteEvent.t when sharing the context). */
  beatsAt: (audioTime: number) => number;
  /** Current beats, computed now. */
  beatsNow: () => number;
}

interface Voices {
  click: Tone.MembraneSynth;
  accent: Tone.MembraneSynth;
  kick: Tone.MembraneSynth;
  hat: Tone.NoiseSynth;
  bass: Tone.MonoSynth;
  gain: Tone.Gain;
}

function buildVoices(): Voices {
  const gain = new Tone.Gain(0.6).toDestination();
  const click = new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 2, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } }).connect(gain);
  const accent = new Tone.MembraneSynth({ pitchDecay: 0.005, octaves: 3, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 } }).connect(gain);
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 } }).connect(gain);
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(gain);
  hat.volume.value = -18;
  const bass = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    filter: { type: "lowpass", Q: 2 },
    filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 120, octaves: 2.2 },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.15 },
  }).connect(gain);
  bass.volume.value = -6;
  return { click, accent, kick, hat, bass, gain };
}

export function useSongTransport(chart: SongChart, audioContext: AudioContext | null): SongTransport {
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpmState] = useState(chart.bpm);
  const [metronome, setMetronome] = useState(true);
  const [backing, setBacking] = useState(false);
  const countInBars = 1;
  const beatsRef = useRef(0);
  const clockRef = useRef(new BeatClock());
  const startAttemptRef = useRef(0);
  const bpmRef = useRef(bpm);
  const chartRef = useRef(chart);
  const flagsRef = useRef({ metronome, backing });
  const voicesRef = useRef<Voices | null>(null);
  const eventIdRef = useRef<number | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    bpmRef.current = bpm;
    chartRef.current = chart;
    flagsRef.current = { metronome, backing };
  });

  const beatsAt = useCallback(
    (audioTime: number) => clockRef.current.beatsAt(audioTime),
    [],
  );

  const beatsNow = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx) return beatsRef.current;
    return beatsAt(ctx.currentTime);
  }, [beatsAt]);

  const stop = useCallback(() => {
    startAttemptRef.current++;
    if (contextRef.current) {
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel(0);
      if (eventIdRef.current !== null) {
        transport.clear(eventIdRef.current);
        eventIdRef.current = null;
      }
    }
    setPlaying(false);
  }, []);

  const disposeVoices = useCallback(() => {
    if (voicesRef.current) {
      Object.values(voicesRef.current).forEach((voice) => voice.dispose());
      voicesRef.current = null;
    }
  }, []);

  // Connecting/changing the input creates a new audio clock. Stop the old
  // song before scoring notes from that clock or closing its voices.
  useEffect(() => {
    if (contextRef.current && contextRef.current !== audioContext) {
      stop();
      disposeVoices();
      contextRef.current = null;
    }
  }, [audioContext, stop, disposeVoices]);

  const start = useCallback(async () => {
    stop();
    const attempt = startAttemptRef.current;
    // Share the pitch hook's context so NoteEvent.t and the transport agree.
    if (audioContext && Tone.getContext().rawContext !== audioContext) {
      disposeVoices();
      Tone.setContext(audioContext);
    } else if (!audioContext && Tone.getContext().state === "closed") {
      Tone.setContext(new Tone.Context());
    }
    await Tone.start();
    if (attempt !== startAttemptRef.current) return;
    const ctx = Tone.getContext().rawContext as AudioContext;
    contextRef.current = ctx;
    if (!voicesRef.current) voicesRef.current = buildVoices();
    const voices = voicesRef.current;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = bpmRef.current;
    transport.position = 0;

    const beatsPerBar = chartRef.current.beatsPerBar;
    const countIn = countInBars * beatsPerBar;
    let eighth = 0; // eighth-note counter from transport start
    eventIdRef.current = transport.scheduleRepeat((time) => {
      const beatFromStart = eighth / 2;
      const isBeat = eighth % 2 === 0;
      const chartBeat = beatFromStart - countIn;
      const beatInBar = ((Math.floor(beatFromStart) % beatsPerBar) + beatsPerBar) % beatsPerBar;
      const flags = flagsRef.current;
      if (isBeat && (flags.metronome || chartBeat < 0)) {
        if (beatInBar === 0) voices.accent.triggerAttackRelease("C5", 0.03, time, 0.8);
        else voices.click.triggerAttackRelease("G4", 0.02, time, 0.5);
      }
      if (flags.backing && chartBeat >= 0) {
        const pos = chartPositionAt(chartRef.current, chartBeat);
        const voicing = chartRef.current.voicings["guitar-standard"]?.[pos.chordId];
        if (isBeat && (beatInBar === 0 || beatInBar === 2)) voices.kick.triggerAttackRelease("C1", 0.15, time, 0.9);
        voices.hat.triggerAttackRelease(0.02, time, isBeat ? 0.6 : 0.35);
        const andOfTwo = !isBeat && beatInBar === 1;
        if (voicing && (isBeat && beatInBar === 0 || andOfTwo)) {
          const midi = 36 + voicing.rootMidiPc;
          voices.bass.triggerAttackRelease(Tone.Frequency(midi, "midi").toFrequency(), andOfTwo ? "8n" : "4n", time, 0.9);
        }
      }
      eighth++;
    }, "8n", 0);
    const now = ctx.currentTime + 0.1;
    clockRef.current.start(now, bpmRef.current, countIn);
    beatsRef.current = -countIn;
    transport.start(now);
    setPlaying(true);
  }, [audioContext, disposeVoices, stop]);

  // Keep beatsRef current for render loops.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      beatsRef.current = beatsNow();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, beatsNow]);

  const setBpm = useCallback((v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(40, Math.min(200, Math.round(v)));
    setBpmState(clamped);
    bpmRef.current = clamped;
    if (playing) {
      // Schedule both clocks at the same safe audio time; retain prior tempo
      // segments for pitch events delivered after the tempo changed.
      const transport = Tone.getTransport();
      const at = Tone.now();
      clockRef.current.setTempo(at, clamped);
      transport.bpm.setValueAtTime(clamped, at);
    }
  }, [playing]);

  useEffect(() => () => {
    stop();
    disposeVoices();
  }, [stop, disposeVoices]);

  return useMemo<SongTransport>(
    () => ({ playing, bpm, setBpm, countInBars, metronome, backing, setMetronome, setBacking, start, stop, beatsRef, beatsAt, beatsNow }),
    [playing, bpm, setBpm, metronome, backing, start, stop, beatsAt, beatsNow],
  );
}
