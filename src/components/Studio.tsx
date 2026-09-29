"use client";

// Studio: a small multitrack recorder for the guitar. Record takes from the
// Spark over a click, arrange and trim them on a timeline, export a WAV mix.
// The project autosaves in this browser.

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import AudioDevicePicker from "@/components/AudioDevicePicker";
import { useStudioEngine } from "@/hooks/useStudioEngine";
import { channelsOf, computePeaks, encodeWav, PEAKS_PER_SECOND, toAudioBuffer } from "@/lib/studio/audio";
import { renderMix, type RecordedTake, type TransportMode } from "@/lib/studio/engine";
import {
  addClip,
  addTrack,
  anySolo,
  carveOut,
  commit,
  deleteClip,
  effectiveGain,
  emptyProject,
  makeTrack,
  MIN_CLIP,
  moveClip,
  newId,
  placeTake,
  redo,
  removeTrack,
  snap,
  splitClip,
  trimClipEnd,
  trimClipStart,
  undo,
  updateTrack,
  formatPosition,
  type History,
  type Project,
} from "@/lib/studio/project";
import { clearStudio, loadStudio, saveBuffer, saveProject } from "@/lib/studio/storage";
import { drawTimeline, hitTest, ROW_H, RULER_H, rowAt, timeAt, type TimelineView } from "@/lib/studio/timeline";

type Action =
  | { type: "edit"; fn: (p: Project) => Project; key?: string }
  | { type: "commit"; project: Project }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; project: Project };

function reducer(history: History, action: Action): History {
  switch (action.type) {
    case "edit":
      return commit(history, action.fn(history.present), action.key);
    case "commit":
      return commit(history, action.project);
    case "undo":
      return undo(history);
    case "redo":
      return redo(history);
    case "load":
      return { past: [], present: action.project, future: [] };
  }
}

const LATENCY_KEY = "bodysynth.studio.latencyMs";
const HEADER_W = 208;
const MIN_ZOOM = 8;
const MAX_ZOOM = 400;

interface Drag {
  kind: "move" | "trim-start" | "trim-end" | "seek";
  clipId: string | null;
  /** Pointer time minus clip start when grabbed. */
  grab: number;
  startX: number;
  startY: number;
  moved: boolean;
}

function readLatency(): number | null {
  try {
    const v = localStorage.getItem(LATENCY_KEY);
    return v === null || !Number.isFinite(Number(v)) ? null : Number(v);
  } catch {
    return null;
  }
}

function registerBuffer(buffers: Map<string, AudioBuffer>, peaks: Map<string, Float32Array>, id: string, buffer: AudioBuffer) {
  buffers.set(id, buffer);
  peaks.set(id, computePeaks(channelsOf(buffer), buffer.sampleRate, PEAKS_PER_SECOND));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const btn = "text-[11px] font-mono px-2.5 py-1.5 rounded transition active:scale-95 disabled:opacity-40";
const btnIdle = `${btn} bg-white/10 hover:bg-white/20 text-white`;
const toggle = (on: boolean) => `${btn} ${on ? "bg-white text-black" : "bg-white/10 hover:bg-white/20 text-zinc-300"}`;

export default function Studio() {
  const [history, dispatch] = useReducer(reducer, undefined, (): History => ({ past: [], present: emptyProject(), future: [] }));
  const project = history.present;
  const studio = useStudioEngine();
  const { engineRef, ensureEngine } = studio;
  const [mode, setMode] = useState<TransportMode>("stopped");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [armedTrackId, setArmedTrackId] = useState<string | null>(null);
  const [metronome, setMetronome] = useState(true);
  const [countIn, setCountIn] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [zoom, setZoomState] = useState(60);
  // Rendered client-only (dynamic import with ssr: false), so storage exists.
  const [latencyMs, setLatencyMs] = useState<number | null>(readLatency);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const buffersRef = useRef(new Map<string, AudioBuffer>());
  const peaksRef = useRef(new Map<string, Float32Array>());
  const playheadRef = useRef(0);
  const scrollXRef = useRef(0);
  const zoomRef = useRef(60);
  const dragRef = useRef<Drag | null>(null);
  const previewRef = useRef<Project | null>(null);
  const recordingRef = useRef<{ trackId: string; start: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef({ project, selectedClipId, armedTrackId });
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  function setZoom(value: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    zoomRef.current = next;
    setZoomState(next);
  }

  // Restore the autosaved project.
  useEffect(() => {
    let cancelled = false;
    loadStudio()
      .then((saved) => {
        if (cancelled || !saved) return;
        for (const b of saved.buffers) {
          registerBuffer(buffersRef.current, peaksRef.current, b.id, toAudioBuffer(b.channels, b.sampleRate));
        }
        const known = new Set(saved.buffers.map((b) => b.id));
        dispatch({ type: "load", project: { ...saved.project, clips: saved.project.clips.filter((c) => known.has(c.bufferId)) } });
      })
      .catch(() => {
        if (!cancelled) setNotice("Autosave is unavailable in this browser; export a WAV to keep your work.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const id = window.setTimeout(() => {
      saveProject(project).catch(() => setNotice("Could not autosave the project."));
    }, 400);
    return () => window.clearTimeout(id);
  }, [project, loaded]);

  // Mute, solo and volume apply live.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const solo = anySolo(project);
    for (const t of project.tracks) engine.setTrackGain(t.id, effectiveGain(t, solo));
  }, [project, engineRef]);

  const options = (p: Project) => ({ bpm: p.bpm, beatsPerBar: p.beatsPerBar, metronome });

  async function play(from = playheadRef.current) {
    try {
      const engine = await ensureEngine();
      engine.play(from, project, buffersRef.current, options(project));
      setMode("playing");
    } catch (err) {
      setNotice(`Audio could not start: ${message(err)}`);
    }
  }

  async function stop() {
    const engine = engineRef.current;
    if (!engine || engine.mode === "stopped") return;
    const rec = recordingRef.current;
    recordingRef.current = null;
    const take = await engine.stop();
    playheadRef.current = engine.position();
    setMode("stopped");
    if (take && rec) addTake(take, rec.trackId);
  }

  async function record() {
    let engine;
    try {
      engine = await ensureEngine();
    } catch (err) {
      setNotice(`Audio could not start: ${message(err)}`);
      return;
    }
    if (!engine.hasInput) await studio.connect();
    if (!engine.hasInput) {
      setNotice("Connect an input to record.");
      return;
    }
    let current = project;
    let trackId = armedTrackId && project.tracks.some((t) => t.id === armedTrackId) ? armedTrackId : null;
    if (!trackId) {
      const track = makeTrack(project, "Guitar");
      current = addTrack(project, track);
      dispatch({ type: "commit", project: current });
      setArmedTrackId(track.id);
      trackId = track.id;
    }
    const latency = (latencyMs ?? studio.refreshLatency()) / 1000;
    const from = playheadRef.current;
    engine.record(from, current, buffersRef.current, options(current), latency, countIn);
    recordingRef.current = { trackId, start: from };
    setSelectedClipId(null);
    setMode("recording");
  }

  function addTake(take: RecordedTake, trackId: string) {
    const bufferId = newId();
    const buffer = toAudioBuffer(take.channels, take.sampleRate);
    registerBuffer(buffersRef.current, peaksRef.current, bufferId, buffer);
    saveBuffer({ id: bufferId, sampleRate: take.sampleRate, channels: take.channels }).catch(() =>
      setNotice("Could not autosave the take; export a WAV to keep it."),
    );
    const placed = placeTake(take.start, buffer.duration);
    if (placed.duration < MIN_CLIP) return;
    const clipId = newId();
    const rightId = newId();
    dispatch({
      type: "edit",
      fn: (p) => {
        if (!p.tracks.some((t) => t.id === trackId)) return p;
        const n = p.clips.filter((c) => c.trackId === trackId).length + 1;
        const cleared = carveOut(p, trackId, placed.start, placed.start + placed.duration, rightId);
        return addClip(cleared, { id: clipId, trackId, bufferId, name: `Take ${n}`, ...placed });
      },
    });
    setSelectedClipId(clipId);
  }

  async function importFile(file: File) {
    setBusy(true);
    try {
      const engine = await ensureEngine();
      const buffer = await engine.decode(await file.arrayBuffer());
      const bufferId = newId();
      registerBuffer(buffersRef.current, peaksRef.current, bufferId, buffer);
      saveBuffer({ id: bufferId, sampleRate: buffer.sampleRate, channels: channelsOf(buffer) }).catch(() =>
        setNotice("Could not autosave the imported audio."),
      );
      const name = file.name.replace(/\.[^.]+$/, "") || "Audio";
      const trackId = newId();
      const clip = { id: newId(), trackId, bufferId, name, start: playheadRef.current, offset: 0, duration: buffer.duration };
      dispatch({ type: "edit", fn: (p) => addClip(addTrack(p, { ...makeTrack(p, name), id: trackId }), clip) });
      setSelectedClipId(clip.id);
    } catch (err) {
      setNotice(`Could not import ${file.name}: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportMix() {
    setBusy(true);
    try {
      const mix = await renderMix(project, buffersRef.current, engineRef.current?.ctx.sampleRate ?? 48000);
      if (!mix) {
        setNotice("Nothing to export yet.");
        return;
      }
      const url = URL.createObjectURL(new Blob([encodeWav(channelsOf(mix), mix.sampleRate)], { type: "audio/wav" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "studio-mix.wav";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setNotice(`Export failed: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function newProject() {
    setConfirmNew(false);
    await stop();
    buffersRef.current.clear();
    peaksRef.current.clear();
    playheadRef.current = 0;
    scrollXRef.current = 0;
    engineRef.current?.seek(0);
    setSelectedClipId(null);
    setArmedTrackId(null);
    dispatch({ type: "load", project: emptyProject() });
    clearStudio().catch(() => setNotice("Could not clear the saved project."));
  }

  function seek(t: number) {
    const at = Math.max(0, t);
    playheadRef.current = at;
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.mode === "playing") engine.play(at, project, buffersRef.current, options(project));
    else if (engine.mode === "stopped") engine.seek(at);
  }

  function position(): number {
    const engine = engineRef.current;
    return engine && engine.mode !== "stopped" ? engine.position() : playheadRef.current;
  }

  function deleteSelected() {
    if (!selectedClipId || !project.clips.some((c) => c.id === selectedClipId)) return;
    const id = selectedClipId;
    dispatch({ type: "edit", fn: (p) => deleteClip(p, id) });
    setSelectedClipId(null);
  }

  function splitSelected() {
    if (!selectedClipId) return;
    const id = selectedClipId;
    const at = position();
    const rightId = newId();
    dispatch({ type: "edit", fn: (p) => splitClip(p, id, at, rightId) });
  }

  useEffect(() => {
    liveRef.current = { project, selectedClipId, armedTrackId };
    keyRef.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (mode === "stopped") void play();
          else void stop();
          break;
        case "r":
        case "R":
          if (mode === "recording") void stop();
          else if (mode === "stopped") void record();
          break;
        case "Backspace":
        case "Delete":
          e.preventDefault();
          deleteSelected();
          break;
        case "s":
        case "S":
          splitSelected();
          break;
        case "Enter":
        case "Home":
          if (mode === "stopped") seek(0);
          break;
      }
    };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wheel: horizontal scroll, and ⌘/ctrl-wheel or pinch to zoom at the pointer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const px = zoomRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const x = e.clientX - canvas.getBoundingClientRect().left;
        const tAtPointer = scrollXRef.current + x / px;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, px * Math.exp(-e.deltaY * 0.01)));
        scrollXRef.current = Math.max(0, tAtPointer - x / next);
        zoomRef.current = next;
        setZoomState(next);
        return;
      }
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (dx) {
        e.preventDefault();
        scrollXRef.current = Math.max(0, scrollXRef.current + dx / px);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Draw loop: timeline, playhead follow, and the position readout.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      const lane = laneRef.current;
      if (!canvas || !lane) return;
      const live = liveRef.current;
      const p = previewRef.current ?? live.project;
      const width = lane.clientWidth;
      const height = RULER_H + (p.tracks.length + 1) * ROW_H;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx || width === 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const engine = engineRef.current;
      const rolling = !!engine && engine.mode !== "stopped";
      const pos = rolling ? engine.position() : playheadRef.current;
      const px = zoomRef.current;
      if (rolling) {
        const x = (pos - scrollXRef.current) * px;
        if (x > width * 0.85 || x < 0) scrollXRef.current = Math.max(0, pos - (width * 0.1) / px);
      }
      drawTimeline(ctx, {
        project: p,
        view: { scrollX: scrollXRef.current, pxPerSec: px, width, height },
        peaks: peaksRef.current,
        selectedClipId: live.selectedClipId,
        armedTrackId: live.armedTrackId,
        playhead: pos,
        recording: recordingRef.current,
      });
      const f = formatPosition(pos, p.bpm, p.beatsPerBar);
      if (barsRef.current) barsRef.current.textContent = pos < 0 ? "count-in" : f.bars;
      if (clockRef.current) clockRef.current.textContent = f.clock;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRef]);

  function view(): TimelineView {
    return { scrollX: scrollXRef.current, pxPerSec: zoomRef.current, width: laneRef.current?.clientWidth ?? 0, height: 0 };
  }

  function pointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const snapT = (t: number, e: { altKey: boolean }) => (snapOn && !e.altKey ? snap(t, project.bpm) : t);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    const { x, y } = pointer(e);
    const hit = hitTest(project, view(), x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit.kind === "clip") {
      setSelectedClipId(hit.clipId);
      if (mode === "recording") return;
      const clip = project.clips.find((c) => c.id === hit.clipId)!;
      const kind = hit.edge === "start" ? "trim-start" : hit.edge === "end" ? "trim-end" : "move";
      dragRef.current = { kind, clipId: clip.id, grab: hit.t - clip.start, startX: x, startY: y, moved: false };
      return;
    }
    if (hit.kind !== "ruler") setSelectedClipId(null);
    if (mode === "recording") return;
    seek(snapT(hit.t, e));
    dragRef.current = { kind: "seek", clipId: null, grab: 0, startX: x, startY: y, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = pointer(e);
    const drag = dragRef.current;
    if (!drag) {
      const hit = hitTest(project, view(), x, y);
      e.currentTarget.style.cursor = hit.kind === "clip" ? (hit.edge ? "ew-resize" : "grab") : "default";
      return;
    }
    if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < 3) return;
    drag.moved = true;
    const t = timeAt(view(), x);
    if (drag.kind === "seek") {
      // Scrub only while stopped; restarting playback on every move stutters.
      if (mode === "stopped") seek(snapT(t, e));
      return;
    }
    const id = drag.clipId!;
    if (drag.kind === "move") {
      const row = Math.min(Math.max(rowAt(y), 0), project.tracks.length - 1);
      previewRef.current = moveClip(project, id, snapT(t - drag.grab, e), project.tracks[row]?.id);
    } else if (drag.kind === "trim-start") {
      previewRef.current = trimClipStart(project, id, snapT(t, e));
    } else {
      const clip = project.clips.find((c) => c.id === id);
      const buffer = clip && buffersRef.current.get(clip.bufferId);
      if (clip && buffer) previewRef.current = trimClipEnd(project, id, snapT(t, e), buffer.duration);
    }
  }

  function onPointerUp() {
    const drag = dragRef.current;
    const preview = previewRef.current;
    dragRef.current = null;
    previewRef.current = null;
    if (drag?.moved && preview) dispatch({ type: "commit", project: preview });
  }

  const recording = mode === "recording";
  const rolling = mode !== "stopped";
  const latencyPlaceholder = studio.inputStatus === "ready" ? `${studio.latencyEstimateMs} auto` : "auto";
  const deviceLabel = studio.devices.find((d) => d.deviceId === studio.deviceId)?.label ?? "";

  return (
    <div className="fixed inset-0 bg-black text-white overflow-y-auto flex flex-col">
      <div className="p-3 sm:p-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">studio</h1>
          <nav className="flex gap-1">
            <Link href="/guitar" className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-zinc-400 hover:text-white">Guitar</Link>
            <Link href="/bass" className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-zinc-400 hover:text-white">Bass</Link>
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => (rolling ? void stop().then(() => seek(0)) : seek(0))} className={btnIdle} title="To start (Enter)">⏮</button>
          <button onClick={() => (rolling ? void stop() : void play())} className={`${btn} w-16 ${rolling ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`} title="Play / stop (Space)">
            {rolling ? "■ Stop" : "▶ Play"}
          </button>
          <button
            onClick={() => (recording ? void stop() : void record())}
            disabled={mode === "playing"}
            className={`${btn} ${recording ? "bg-red-500 text-white animate-pulse" : "bg-white/10 hover:bg-red-500/40 text-red-300"}`}
            title="Record (R)"
          >
            ● Rec
          </button>
          <div className="ml-2 font-mono text-sm tabular-nums">
            <span ref={barsRef} className="inline-block w-20 text-emerald-300">1.1</span>
            <span ref={clockRef} className="text-zinc-400">0:00.0</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          <label className="flex items-center gap-1 text-zinc-400">
            bpm
            <input
              type="number"
              min={40}
              max={240}
              value={project.bpm}
              disabled={rolling}
              onChange={(e) => {
                const bpm = Math.round(Number(e.target.value));
                if (bpm >= 40 && bpm <= 240) dispatch({ type: "edit", fn: (p) => ({ ...p, bpm }), key: "bpm" });
              }}
              className="w-14 bg-black/40 border border-white/10 rounded px-1 py-1 text-center text-white"
            />
          </label>
          <button onClick={() => setMetronome((v) => !v)} className={toggle(metronome)} disabled={rolling}>click</button>
          <button onClick={() => setCountIn((v) => !v)} className={toggle(countIn)}>count-in</button>
          <button onClick={() => setSnapOn((v) => !v)} className={toggle(snapOn)}>snap</button>
          <label className="flex items-center gap-1 text-zinc-400">
            zoom
            <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-20" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          {studio.inputStatus === "ready" ? (
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 max-w-[200px] truncate" title={deviceLabel}>
              in · {deviceLabel.replace(/\s*\(.*\)\s*$/, "") || "input"}
            </span>
          ) : studio.inputStatus === "connecting" ? (
            <span className="px-2.5 py-1 rounded-full bg-white/10 text-zinc-300">connecting…</span>
          ) : (
            <button onClick={() => void studio.connect()} className="px-2.5 py-1 rounded-full bg-white text-black active:scale-95">Connect input</button>
          )}
          {(studio.inputStatus === "needs-device" || studio.devices.length > 1) && (
            <AudioDevicePicker devices={studio.devices} selectedDeviceId={studio.deviceId} onSelect={studio.selectDevice} />
          )}
          {studio.error && studio.inputStatus === "error" && (
            <span className="text-red-300 max-w-[220px] truncate" title={studio.error}>
              {/NotAllowed|Permission/i.test(studio.error) ? "microphone blocked: allow it in site settings" : studio.error}
            </span>
          )}
          <label className="flex items-center gap-1 text-zinc-400" title="Shifts new takes earlier to line up with what you heard">
            latency ms
            <input
              type="number"
              min={0}
              max={500}
              value={latencyMs ?? ""}
              placeholder={latencyPlaceholder}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Math.max(0, Math.min(500, Math.round(Number(e.target.value))));
                setLatencyMs(v);
                try {
                  if (v === null) localStorage.removeItem(LATENCY_KEY);
                  else localStorage.setItem(LATENCY_KEY, String(v));
                } catch {
                  // Storage blocked: keep the value for this session.
                }
              }}
              className="w-20 bg-black/40 border border-white/10 rounded px-1 py-1 text-center text-white placeholder:text-zinc-600"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          <button onClick={() => dispatch({ type: "undo" })} disabled={history.past.length === 0} className={btnIdle} title="Undo (⌘Z)">↶</button>
          <button onClick={() => dispatch({ type: "redo" })} disabled={history.future.length === 0} className={btnIdle} title="Redo (⇧⌘Z)">↷</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy || recording} className={btnIdle}>Import audio</button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <button onClick={() => void exportMix()} disabled={busy || project.clips.length === 0} className={`${btn} bg-emerald-400 text-black`}>
            Export WAV
          </button>
          {confirmNew ? (
            <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-300">
              discard everything?
              <button onClick={() => void newProject()} className={`${btn} bg-red-500 text-white`}>Yes</button>
              <button onClick={() => setConfirmNew(false)} className={btnIdle}>No</button>
            </span>
          ) : (
            <button onClick={() => setConfirmNew(true)} disabled={recording} className={btnIdle}>New</button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-center justify-between gap-2 bg-amber-300/10 px-4 py-2 text-xs text-amber-200">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="px-2 rounded hover:bg-amber-200/10">dismiss</button>
        </div>
      )}

      <div className="flex">
        <div className="flex-shrink-0 border-r border-white/10" style={{ width: HEADER_W }}>
          <div className="flex items-center px-2" style={{ height: RULER_H }}>
            <button
              onClick={() => {
                const track = makeTrack(project);
                dispatch({ type: "edit", fn: (p) => addTrack(p, { ...makeTrack(p), id: track.id }) });
                setArmedTrackId(track.id);
              }}
              disabled={recording}
              className="text-[11px] font-mono text-zinc-400 hover:text-white disabled:opacity-40"
            >
              + track
            </button>
          </div>
          {project.tracks.map((track) => {
            const armed = track.id === armedTrackId;
            return (
              <div key={track.id} className="flex flex-col justify-center gap-1 px-2 border-t border-white/5" style={{ height: ROW_H }}>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: track.color }} />
                  <input
                    key={`${track.id}:${track.name}`}
                    defaultValue={track.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== track.name) dispatch({ type: "edit", fn: (p) => updateTrack(p, track.id, { name }) });
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none focus:bg-white/5 rounded px-1"
                  />
                  <button
                    onClick={() => dispatch({ type: "edit", fn: (p) => removeTrack(p, track.id) })}
                    disabled={recording}
                    className="text-zinc-600 hover:text-red-300 text-sm px-1 disabled:opacity-40"
                    title="Delete track"
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setArmedTrackId(armed ? null : track.id)}
                    disabled={recording}
                    className={`w-6 h-5 rounded text-[10px] ${armed ? "bg-red-500 text-white" : "bg-white/10 text-red-300 hover:bg-red-500/30"}`}
                    title="Record on this track"
                  >
                    ●
                  </button>
                  <button
                    onClick={() => dispatch({ type: "edit", fn: (p) => updateTrack(p, track.id, { muted: !track.muted }) })}
                    className={`w-6 h-5 rounded text-[10px] font-mono ${track.muted ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-300 hover:bg-white/20"}`}
                    title="Mute"
                  >
                    M
                  </button>
                  <button
                    onClick={() => dispatch({ type: "edit", fn: (p) => updateTrack(p, track.id, { solo: !track.solo }) })}
                    className={`w-6 h-5 rounded text-[10px] font-mono ${track.solo ? "bg-sky-400 text-black" : "bg-white/10 text-zinc-300 hover:bg-white/20"}`}
                    title="Solo"
                  >
                    S
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={track.volume}
                    onChange={(e) => {
                      const volume = Number(e.target.value);
                      dispatch({ type: "edit", fn: (p) => updateTrack(p, track.id, { volume }), key: `volume:${track.id}` });
                    }}
                    className="flex-1 min-w-0"
                    title={`Volume ${Math.round(track.volume * 100)}%`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div ref={laneRef} className="relative flex-1 min-w-0">
          <canvas
            ref={canvasRef}
            className="block w-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {loaded && project.tracks.length === 0 && (
            <div className="pointer-events-none absolute left-4 text-sm text-zinc-500" style={{ top: RULER_H + 24 }}>
              Press <span className="text-red-300">● Rec</span> (or R) to record a take from your guitar, or import audio.
            </div>
          )}
        </div>
      </div>

      <p className="mt-auto px-4 py-3 text-[11px] font-mono text-zinc-600 leading-relaxed">
        Space play/stop · R record · S split at playhead · ⌫ delete clip · ⌘Z undo · drag clips to move (also between tracks), drag edges to trim ·
        hold ⌥ to skip snapping · shift-scroll or swipe to scroll, ⌘-scroll or pinch to zoom · a new take replaces what is under it on its track ·
        listen through the pedal&apos;s headphones or line out · autosaved in this browser
      </p>
    </div>
  );
}
