"use client";

// Guitar pitch input: device selection (Spark over USB preferred), filter
// chain, AudioWorklet pitch/onset detection, and NoteEvent segmentation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import {
  getStoredInputLatencyMs,
  instrumentConstraints,
  listAudioInputs,
  pickPreferredDevice,
  storeDevice,
} from "@/lib/audio/devices";
import { NoteTracker } from "@/lib/audio/noteTracker";
import type { NoteEvent, NoteOff, PitchFrame, WorkletConfig, WorkletMessage } from "@/lib/audio/pitchTypes";
import { createTestSignal, type TestSignal } from "@/lib/audio/testSignal";

export type GuitarPitchStatus = "idle" | "needs-device" | "starting" | "running" | "suspended" | "error";

export interface GuitarPitchTuning {
  gateDb: number;
  clarityThreshold: number;
  k: number;
  notch60: boolean;
}

export interface GuitarPitch {
  status: GuitarPitchStatus;
  error: string | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  selectDevice: (id: string) => void;
  /** Must be called from a user gesture. */
  start: () => Promise<void>;
  stop: () => void;
  frameRef: React.RefObject<PitchFrame | null>;
  activeNoteRef: React.RefObject<NoteEvent | null>;
  noteLogRef: React.RefObject<NoteEvent[]>;
  lastOnsetRef: React.RefObject<number>;
  onNote: (cb: (e: NoteEvent) => void) => () => void;
  onNoteOff: (cb: (e: NoteOff) => void) => () => void;
  audioTimeToPerf: (t: number) => number;
  context: AudioContext | null;
  settings: MediaTrackSettings | null;
  tuning: GuitarPitchTuning;
  setTuning: (patch: Partial<GuitarPitchTuning>) => void;
  test: TestSignal | null;
}

const WORKLET_URL = "/worklets/pitch-processor.js";

const EMPTY_FRAME: PitchFrame = { t: 0, hz: 0, midiFloat: NaN, midi: -1, cents: 0, clarity: 0, rms: 0, db: -120 };

export function useGuitarPitch(profile: InstrumentProfile): GuitarPitch {
  const [status, setStatus] = useState<GuitarPitchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);
  const [context, setContext] = useState<AudioContext | null>(null);
  const [test, setTest] = useState<TestSignal | null>(null);
  const [tuning, setTuningState] = useState<GuitarPitchTuning>({
    gateDb: -45,
    clarityThreshold: profile.pitch.clarityThreshold,
    k: 0.9,
    notch60: false,
  });

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const notchRef = useRef<BiquadFilterNode | null>(null);
  const inputNodeRef = useRef<BiquadFilterNode | null>(null);
  const trackerRef = useRef<NoteTracker>(
    new NoteTracker({ gateDb: -45, clarityThreshold: profile.pitch.clarityThreshold, hopMs: profile.pitch.hopMs }),
  );
  const frameRef = useRef<PitchFrame | null>(EMPTY_FRAME);
  const activeNoteRef = useRef<NoteEvent | null>(null);
  const noteLogRef = useRef<NoteEvent[]>([]);
  const lastOnsetRef = useRef<number>(0);
  const noteCbs = useRef(new Set<(e: NoteEvent) => void>());
  const noteOffCbs = useRef(new Set<(e: NoteOff) => void>());
  const perfOffsetRef = useRef(0);
  const inputLatencyRef = useRef(getStoredInputLatencyMs());
  const tuningRef = useRef(tuning);
  useEffect(() => {
    tuningRef.current = tuning;
  });

  const audioTimeToPerf = useCallback(
    (t: number) => t * 1000 + perfOffsetRef.current - inputLatencyRef.current,
    [],
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
    ctxRef.current = null;
    setContext(null);
    setTest(null);
    trackerRef.current.reset();
    activeNoteRef.current = null;
    frameRef.current = EMPTY_FRAME;
    setStatus("idle");
  }, []);

  const sendConfig = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    const t = tuningRef.current;
    const cfg: WorkletConfig = {
      fMin: profile.pitch.fMin,
      fMax: profile.pitch.fMax,
      windowMs: profile.pitch.windowMs,
      hopMs: profile.pitch.hopMs,
      clarityThreshold: t.clarityThreshold,
      gateDb: t.gateDb,
      k: t.k,
      onsetRiseDb: 6,
      refractoryMs: 60,
    };
    node.port.postMessage({ type: "config", profile: cfg });
    trackerRef.current.setOptions({ gateDb: t.gateDb, clarityThreshold: t.clarityThreshold, hopMs: profile.pitch.hopMs });
    if (notchRef.current) notchRef.current.Q.value = t.notch60 ? 30 : 0.0001;
    if (notchRef.current) notchRef.current.gain.value = 0;
  }, [profile]);

  const setTuning = useCallback(
    (patch: Partial<GuitarPitchTuning>) => {
      setTuningState((prev) => {
        const next = { ...prev, ...patch };
        tuningRef.current = next;
        return next;
      });
      // Push immediately so the worklet/tracker do not wait for a re-render.
      queueMicrotask(sendConfig);
    },
    [sendConfig],
  );

  const startWithDevice = useCallback(
    async (deviceId: string) => {
      setStatus("starting");
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia(instrumentConstraints(deviceId));
        streamRef.current = stream;
        setSettings(stream.getAudioTracks()[0]?.getSettings() ?? null);

        const ctx = new AudioContext({ latencyHint: "interactive" });
        ctxRef.current = ctx;
        await ctx.audioWorklet.addModule(WORKLET_URL);
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});

        const source = ctx.createMediaStreamSource(stream);
        const hpf = ctx.createBiquadFilter();
        hpf.type = "highpass";
        hpf.frequency.value = 40;
        hpf.Q.value = 0.707;
        const notch = ctx.createBiquadFilter();
        notch.type = "notch";
        notch.frequency.value = 60;
        notch.Q.value = tuningRef.current.notch60 ? 30 : 0.0001;
        const lpf = ctx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.value = profile.pitch.lpfHz;
        lpf.Q.value = 0.707;
        const node = new AudioWorkletNode(ctx, "pitch-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: "explicit",
        });
        source.connect(hpf).connect(notch).connect(lpf).connect(node);
        nodeRef.current = node;
        notchRef.current = notch;
        inputNodeRef.current = hpf;

        const tracker = trackerRef.current;
        tracker.reset();
        tracker.audioToPerf = audioTimeToPerf;
        node.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
          const msg = e.data;
          if (msg.type === "onset") lastOnsetRef.current = msg.t;
          const out = tracker.handle(msg);
          if (out.frame) frameRef.current = out.frame;
          if (out.noteOff) {
            activeNoteRef.current = null;
            noteOffCbs.current.forEach((cb) => cb(out.noteOff!));
          }
          if (out.noteOn) {
            activeNoteRef.current = out.noteOn;
            const log = noteLogRef.current;
            log.push(out.noteOn);
            if (log.length > 50) log.splice(0, log.length - 50);
            noteCbs.current.forEach((cb) => cb(out.noteOn!));
          }
        };
        sendConfig();
        setContext(ctx);
        setTest(createTestSignal(ctx, hpf));
        setStatus(ctx.state === "running" ? "running" : "suspended");
      } catch (err) {
        console.error("guitar input error", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        storeDevice(null);
      }
    },
    [audioTimeToPerf, profile, sendConfig],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const list = await listAudioInputs();
      setDevices(list);
      const preferred = pickPreferredDevice(list);
      if (!preferred) {
        setStatus("needs-device");
        return;
      }
      setSelectedDeviceId(preferred.deviceId);
      storeDevice(preferred);
      await startWithDevice(preferred.deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [startWithDevice]);

  const selectDevice = useCallback(
    (id: string) => {
      const dev = devices.find((d) => d.deviceId === id) ?? null;
      setSelectedDeviceId(id);
      storeDevice(dev);
      if (ctxRef.current) stop();
      startWithDevice(id);
    },
    [devices, startWithDevice, stop],
  );

  // Clock mapping between AudioContext time and performance.now().
  useEffect(() => {
    const ctx = context;
    if (!ctx) return;
    const sync = () => {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined) {
        perfOffsetRef.current = ts.performanceTime - ts.contextTime * 1000;
      }
      setStatus((s) => (s === "running" || s === "suspended" ? (ctx.state === "running" ? "running" : "suspended") : s));
    };
    sync();
    const id = window.setInterval(sync, 1000);
    const onFocus = () => {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const onDeviceChange = () => listAudioInputs().then(setDevices).catch(() => {});
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }, [context]);

  useEffect(() => () => stop(), [stop]);

  const onNote = useCallback((cb: (e: NoteEvent) => void) => {
    noteCbs.current.add(cb);
    return () => {
      noteCbs.current.delete(cb);
    };
  }, []);
  const onNoteOff = useCallback((cb: (e: NoteOff) => void) => {
    noteOffCbs.current.add(cb);
    return () => {
      noteOffCbs.current.delete(cb);
    };
  }, []);

  return useMemo<GuitarPitch>(
    () => ({
      status,
      error,
      devices,
      selectedDeviceId,
      selectDevice,
      start,
      stop,
      frameRef,
      activeNoteRef,
      noteLogRef,
      lastOnsetRef,
      onNote,
      onNoteOff,
      audioTimeToPerf,
      context,
      settings,
      tuning,
      setTuning,
      test,
    }),
    [status, error, devices, selectedDeviceId, selectDevice, start, stop, onNote, onNoteOff, audioTimeToPerf, context, settings, tuning, setTuning, test],
  );
}
