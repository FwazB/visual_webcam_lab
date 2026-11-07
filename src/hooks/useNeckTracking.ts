"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { HandDetection } from "./useHandTracking";
import type { NeckPoint } from "@/lib/instrument/neckMapping";

export type NeckTrackingStatus = "loading" | "idle" | "detecting" | "proposal" | "tracking" | "searching" | "paused" | "error";
export interface NeckPose { points: NeckPoint[]; capturedAt: number; mediaTime: number }
export interface NeckCameraIdentity {
  video: HTMLVideoElement;
  source: HTMLVideoElement["srcObject"];
  track: MediaStreamTrack | null;
  width: number;
  height: number;
}
export interface NeckSnapshot {
  camera: NeckCameraIdentity;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  capturedAt: number;
  mediaTime: number;
}
type NeckCorners = [NeckPoint, NeckPoint, NeckPoint, NeckPoint];
export interface NeckProposal {
  points: NeckCorners;
  wireCount: number;
  /** Observed wire segments in sensor coordinates, from the first end to the last. */
  frets: { a: NeckPoint; b: NeckPoint }[];
}

interface Controls { freeze(): boolean; find(): void; seed(points: NeckPoint[]): void; reset(): void; pause(): void; resume(): void }
interface Source {
  video: HTMLVideoElement | null;
  object: HTMLVideoElement["srcObject"];
  tracks: MediaStreamTrack[];
  width: number;
  height: number;
  usable: boolean;
}
interface Operation {
  type: "detect" | "seed" | "frame";
  epoch: number;
  frame: NeckSnapshot;
  points?: NeckPoint[];
}
interface Flight extends Operation { frameId: number }

const FRESH_MS = 250;
const FRAME_INTERVAL_MS = 1000 / 15;
const SEARCH_INTERVAL_MS = 1500;
const REACQUIRE_MS = 3000;

function pointFrom(value: unknown): NeckPoint | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as NeckPoint;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function pointsFrom(value: unknown): NeckCorners | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const copied = value.map(pointFrom);
  return copied.every(p => p !== null) ? copied as NeckCorners : null;
}

function proposalFrom(value: unknown): NeckProposal | null {
  if (!value || typeof value !== "object") return null;
  const proposal = value as Partial<NeckProposal>;
  const points = pointsFrom(proposal.points);
  const { wireCount, frets } = proposal;
  if (!points || typeof wireCount !== "number" || !Number.isInteger(wireCount) || wireCount < 2 || wireCount > 40
    || !Array.isArray(frets) || frets.length !== wireCount) return null;
  const polygon = [points[0], points[2], points[3], points[1]];
  const turns = polygon.map((p, i) => {
    const next = polygon[(i + 1) % 4], after = polygon[(i + 2) % 4];
    return (next.x - p.x) * (after.y - next.y) - (next.y - p.y) * (after.x - next.x);
  });
  if (!turns.every(turn => turn > 1e-6) && !turns.every(turn => turn < -1e-6)) return null;
  const copied = [];
  const progress = [-Infinity, -Infinity];
  for (const fret of frets) {
    const a = pointFrom(fret?.a), b = pointFrom(fret?.b);
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 1e-5) return null;
    for (const [side, point] of [a, b].entries()) {
      const start = points[side], end = points[side + 2];
      const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy;
      if (squared < 1e-8) return null;
      const fraction = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared;
      const offset = Math.abs(dx * (point.y - start.y) - dy * (point.x - start.x)) / Math.sqrt(squared);
      if (offset > 1e-4 || fraction < -1e-6 || fraction > 1 + 1e-6 || fraction <= progress[side]) return null;
      progress[side] = fraction;
    }
    copied.push({ a, b });
  }
  const ends = [copied[0].a, copied[0].b, copied.at(-1)!.a, copied.at(-1)!.b];
  if (ends.some((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y) > 1e-6)) return null;
  return { points, wireCount, frets: copied };
}

/** Owns the worker, not the camera. Background detection snapshots never become live poses. */
export function useNeckTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  handsRef: RefObject<HandDetection[]>,
  handsUpdatedAtRef: RefObject<number>,
) {
  const poseRef = useRef<NeckPose | null>(null);
  const snapshotRef = useRef<NeckSnapshot | null>(null);
  const controlsRef = useRef<Controls | null>(null);
  const [status, setStatus] = useState<NeckTrackingStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<NeckProposal | null>(null);

  useEffect(() => {
    let disposed = false;
    let worker: Worker | null = null;
    let ready = false;
    let terminalError: string | null = null;
    let epoch = 0;
    let frameId = 0;
    let active = false;
    let enabled = true;
    let awaitingProposal = false;
    let nextSearchAt = 0;
    let lastSearchMediaTime = -Infinity;
    let lostSince: number | null = null;
    let pending: Operation | null = null;
    let flight: Flight | null = null;
    let source: Source | null = null;
    let lastMediaTime = -Infinity;
    let lastSampleAt = -Infinity;
    let raf = 0;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    let operationTimer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const liveCanvas = document.createElement("canvas");
    const frameExclusions = new WeakMap<NeckSnapshot, { x: number; y: number; width: number; height: number }[]>();

    function clearPose() {
      poseRef.current = null;
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    }

    function advanceEpoch() {
      epoch++;
      active = false;
      awaitingProposal = false;
      lostSince = null;
      pending = null;
      lastMediaTime = -Infinity;
      lastSampleAt = -Infinity;
      clearPose();
      snapshotRef.current = null;
      setProposal(null);
      if (ready && worker) worker.postMessage({ type: "reset", epoch });
      // An obsolete request still owns the worker until its reply, so new frames never queue behind it.
    }

    function fail(message: string, terminal = false) {
      active = false;
      pending = null;
      awaitingProposal = false;
      clearPose();
      snapshotRef.current = null;
      nextSearchAt = performance.now() + SEARCH_INTERVAL_MS;
      setProposal(null);
      setError(enabled ? message : null);
      setStatus(enabled ? "error" : "paused");
      if (terminal) {
        terminalError = message;
        clearTimeout(loadTimer);
        clearTimeout(operationTimer);
        flight = null;
        ready = false;
        worker?.terminate();
        worker = null;
      }
    }

    function readSource(): Source {
      const video = videoRef.current;
      const object = video?.srcObject ?? null;
      const tracks = object && "getVideoTracks" in object ? [...object.getVideoTracks()] : [];
      const usable = !!video && video.readyState >= 2 && !video.paused && !video.ended
        && Number.isFinite(video.currentTime) && video.videoWidth > 0 && video.videoHeight > 0
        && (!object || !("getVideoTracks" in object)
          || tracks.some(track => track.readyState === "live" && track.enabled && !track.muted));
      return { video, object, tracks, width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0, usable };
    }

    function checkSource(): Source {
      const next = readSource();
      const changed = source && (next.video !== source.video || next.object !== source.object
        || next.width !== source.width || next.height !== source.height || next.usable !== source.usable
        || next.tracks.length !== source.tracks.length || next.tracks.some((track, i) => track !== source!.tracks[i]));
      if (changed) {
        advanceEpoch();
        nextSearchAt = 0;
        lastSearchMediaTime = -Infinity;
        if (!terminalError) {
          setStatus(!enabled ? "paused" : ready ? "idle" : "loading");
          setError(null);
        }
      }
      source = next;
      return next;
    }

    function capture(frozen: boolean): NeckSnapshot | null {
      const current = checkSource();
      if (!current.usable || !current.video) return null;
      const canvas = frozen ? document.createElement("canvas") : liveCanvas;
      const scale = Math.min(1, 960 / current.width, 960 / current.height);
      canvas.width = Math.max(1, Math.round(current.width * scale));
      canvas.height = Math.max(1, Math.round(current.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Camera image readback is unavailable.");
      // Preserve the acquisition time, including any synchronous draw/readback delay.
      const capturedAt = performance.now();
      const mediaTime = current.video.currentTime;
      context.drawImage(current.video, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const frame: NeckSnapshot = { canvas, width: canvas.width, height: canvas.height, rgba, capturedAt, mediaTime,
        camera: { video: current.video, source: current.object, track: current.tracks[0] ?? null,
          width: current.width, height: current.height } };
      frameExclusions.set(frame, exclusions(capturedAt));
      return frame;
    }

    function exclusions(capturedAt: number) {
      const age = capturedAt - handsUpdatedAtRef.current;
      if (!Number.isFinite(age) || age < 0 || age > FRESH_MS) return [];
      return handsRef.current.flatMap(hand => {
        const points = hand.landmarks.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)
          && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
        if (!points.length) return [];
        const x = Math.max(0, Math.min(...points.map(p => p.x)) - 0.03);
        const y = Math.max(0, Math.min(...points.map(p => p.y)) - 0.03);
        const right = Math.min(1, Math.max(...points.map(p => p.x)) + 0.03);
        const bottom = Math.min(1, Math.max(...points.map(p => p.y)) + 0.03);
        return [{ x, y, width: right - x, height: bottom - y }];
      });
    }

    function send(operation: Operation) {
      if (disposed || !worker || !ready || flight || operation.epoch !== epoch) return;
      const { frame, type, points } = operation;
      const id = ++frameId;
      // Reference snapshots survive detection and seeding; disposable live frames transfer ownership.
      const rgba = type === "frame" ? frame.rgba.buffer as ArrayBuffer : frame.rgba.slice().buffer;
      flight = { ...operation, frameId: id };
      operationTimer = setTimeout(() => {
        if (!disposed && flight?.frameId === id) fail("Fretboard tracking timed out. Retry neck tracking; hand tracking and audio remain independent.", true);
      }, 5000);
      try {
        worker.postMessage({ type, epoch, frameId: id, capturedAt: frame.capturedAt, mediaTime: frame.mediaTime,
          width: frame.width, height: frame.height, rgba, points, exclusions: frameExclusions.get(frame) ?? [] }, [rgba]);
      } catch {
        fail("Fretboard tracking could not receive the camera frame. Retry neck tracking.", true);
      }
    }

    function flush() {
      if (!pending || flight || !ready) return;
      const operation = pending;
      pending = null;
      send(operation);
    }

    function sample(now: number) {
      const current = checkSource();
      if (!enabled || !active || !current.usable || !current.video || flight || pending || !ready) return;
      if (now - lastSampleAt < FRAME_INTERVAL_MS || current.video.currentTime === lastMediaTime) return;
      try {
        const frame = capture(false);
        if (!frame) return;
        lastSampleAt = frame.capturedAt;
        lastMediaTime = frame.mediaTime;
        send({ type: "frame", epoch, frame });
      } catch {
        fail("The camera frame could not be read. Check camera access.");
      }
    }

    function freeze(): boolean {
      if (disposed) return false;
      enabled = true;
      advanceEpoch();
      awaitingProposal = true;
      setError(null);
      setStatus("idle");
      try {
        const snapshot = capture(true);
        if (!snapshot) { awaitingProposal = false; setError("Wait for a live camera image, then try again."); return false; }
        if (!worker && !startWorker()) return false;
        snapshotRef.current = snapshot;
        setStatus(ready ? "idle" : "loading");
        return true;
      } catch {
        fail("The camera frame could not be read. Check camera access and try again.");
        return false;
      }
    }

    function find() {
      if (!freeze()) return;
      awaitingProposal = false;
      lastSearchMediaTime = snapshotRef.current!.mediaTime;
      pending = { type: "detect", epoch, frame: snapshotRef.current! };
      setStatus("detecting");
      flush();
    }

    function search(now: number) {
      const current = checkSource();
      if (!enabled || terminalError || !ready || flight || pending || awaitingProposal || !current.usable || !current.video
        || now < nextSearchAt || current.video.currentTime === lastSearchMediaTime) return;
      if (active && (lostSince === null || now - lostSince < REACQUIRE_MS)) return;
      find();
    }

    function markLost() {
      clearPose();
      lostSince ??= performance.now();
      if (active) setStatus("searching");
    }

    controlsRef.current = {
      freeze,
      find,
      seed(points) {
        if (disposed || !enabled || terminalError) return;
        checkSource();
        const snapshot = snapshotRef.current;
        const copied = pointsFrom(points);
        if (!snapshot || !copied) { fail("Waiting for a fresh fretboard image before tracking."); return; }
        advanceEpoch();
        snapshotRef.current = snapshot;
        pending = { type: "seed", epoch, frame: snapshot, points: copied };
        setError(null);
        setStatus("searching");
        flush();
      },
      reset() {
        if (disposed) return;
        advanceEpoch();
        nextSearchAt = performance.now() + SEARCH_INTERVAL_MS;
        if (!terminalError) { setError(null); setStatus(!enabled ? "paused" : ready ? "idle" : "loading"); }
      },
      pause() {
        if (disposed) return;
        enabled = false;
        advanceEpoch();
        setError(null);
        setStatus("paused");
      },
      resume() {
        if (disposed) return;
        enabled = true;
        advanceEpoch();
        nextSearchAt = 0;
        lastSearchMediaTime = -Infinity;
        terminalError = null;
        if (!worker && checkSource().usable) { startWorker(); return; }
        setError(null);
        setStatus(ready ? "idle" : "loading");
      },
    };

    function startWorker(): boolean {
      if (disposed) return false;
      terminalError = null;
      ready = false;
      setError(null);
      setStatus("loading");
      try {
        const startedWorker = new Worker("/vision/fretboard-worker.js");
        worker = startedWorker;
        loadTimer = setTimeout(() => {
          if (!disposed && worker === startedWorker && !ready) fail("Fretboard tracking could not finish loading. Retry neck tracking; audio practice still works.", true);
        }, 15000);
        startedWorker.onerror = () => { if (!disposed && worker === startedWorker) fail("Fretboard tracking could not load or stopped unexpectedly. Retry neck tracking; audio practice still works.", true); };
        startedWorker.onmessage = ({ data }) => {
          // A terminated worker can still have a callback queued on the main thread.
          if (disposed || worker !== startedWorker || !data) return;
          if (data.type === "ready") {
            if (ready || terminalError) return;
            ready = true;
            clearTimeout(loadTimer);
            checkSource();
            worker?.postMessage({ type: "reset", epoch });
            if (!pending) setStatus(enabled ? "idle" : "paused");
            flush();
            return;
          }
          if (data.type === "error" && data.epoch === undefined) {
            fail(typeof data.message === "string" ? data.message : "Fretboard tracking could not load. Retry neck tracking.", true);
            return;
          }
          const completed = flight;
          if (!completed || data.epoch !== completed.epoch || data.frameId !== completed.frameId) return;
          flight = null;
          clearTimeout(operationTimer);
          checkSource();
          if (data.epoch !== epoch) { flush(); return; }
          if (data.capturedAt !== completed.frame.capturedAt || data.mediaTime !== completed.frame.mediaTime) {
            if (completed.type !== "frame") fail("Fretboard tracking returned a mismatched camera frame. Looking for a fresh image.");
            flush();
            return;
          }
          if (data.type === "error") {
            if (completed.type === "seed") snapshotRef.current = null;
            fail(typeof data.message === "string" ? data.message : "Fretboard tracking stopped. Looking for a fresh image.");
            return;
          }
          if (completed.type === "detect" && data.type === "detected") {
            const detected = proposalFrom(data.proposal);
            if (detected) {
              awaitingProposal = true;
              setProposal(detected);
              setStatus("proposal");
            } else {
              snapshotRef.current = null;
              nextSearchAt = performance.now() + SEARCH_INTERVAL_MS;
              setStatus("searching");
              setError(null);
            }
          } else if (completed.type === "seed" && data.type === "seeded" && data.status === "tracking") {
            snapshotRef.current = null;
            clearPose();
            active = true;
            lostSince = performance.now();
            lastMediaTime = completed.frame.mediaTime;
            lastSampleAt = -Infinity;
            setStatus("searching");
            sample(performance.now());
          } else if (completed.type === "frame" && data.type === "pose") {
            const age = performance.now() - data.capturedAt;
            const points = pointsFrom(data.points);
            if (!Number.isFinite(age) || age < 0 || age > FRESH_MS || !points
              || (data.status !== "tracking" && data.status !== "reacquired")) {
              markLost();
            } else {
              lostSince = null;
              poseRef.current = { points, capturedAt: data.capturedAt, mediaTime: data.mediaTime };
              setStatus("tracking");
              clearTimeout(expiryTimer);
              const acceptedPose = poseRef.current;
              expiryTimer = setTimeout(() => {
                if (disposed || poseRef.current !== acceptedPose) return;
                markLost();
              }, Math.max(1, FRESH_MS + 1 - age));
            }
          } else {
            fail("Fretboard tracking returned an unexpected result. Looking for a fresh image.");
          }
          flush();
        };
        return true;
      } catch {
        fail("This browser could not start fretboard tracking. Retry neck tracking or use a browser with Web Worker support.", true);
        return false;
      }
    }
    // Camera permission may be denied or pending indefinitely: load OpenCV only for usable video.
    if (readSource().usable) startWorker();

    function tick() {
      if (disposed) return;
      const now = performance.now();
      if (poseRef.current && now - poseRef.current.capturedAt > FRESH_MS) {
        markLost();
      }
      const current = checkSource();
      if (enabled && !worker && !terminalError && current.usable) startWorker();
      search(now);
      sample(now);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      controlsRef.current = null;
      cancelAnimationFrame(raf);
      clearTimeout(loadTimer);
      clearTimeout(operationTimer);
      clearPose();
      snapshotRef.current = null;
      worker?.terminate();
      worker = null;
    };
  }, [videoRef, handsRef, handsUpdatedAtRef]);

  const freeze = useCallback(() => controlsRef.current?.freeze() ?? false, []);
  const find = useCallback(() => controlsRef.current?.find(), []);
  const seed = useCallback((points: NeckPoint[]) => controlsRef.current?.seed(points), []);
  const reset = useCallback(() => controlsRef.current?.reset(), []);
  const pause = useCallback(() => controlsRef.current?.pause(), []);
  const resume = useCallback(() => controlsRef.current?.resume(), []);
  return { poseRef, status, error, proposal, snapshotRef, freeze, find, seed, reset, pause, resume };
}
