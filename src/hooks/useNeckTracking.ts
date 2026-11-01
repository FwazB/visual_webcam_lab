"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { HandDetection } from "./useHandTracking";
import type { NeckPoint } from "@/lib/instrument/neckMapping";

export type NeckTrackingStatus = "loading" | "idle" | "detecting" | "proposal" | "tracking" | "searching" | "error";
export interface NeckPose { points: NeckPoint[]; capturedAt: number; mediaTime: number }
export interface NeckSnapshot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  capturedAt: number;
  mediaTime: number;
}
export interface NeckProposal { points: NeckPoint[]; wireCount: number }

interface Controls { freeze(): boolean; find(): void; seed(points: NeckPoint[]): void; reset(): void }
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

function pointsFrom(value: unknown): NeckPoint[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return null;
  return value.map(({ x, y }) => ({ x, y }));
}

/** Owns the worker, not the camera. Frozen calibration images never become live poses. */
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
      clearPose();
      setProposal(null);
      setError(message);
      setStatus("error");
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
        const hadReference = active || pending !== null || snapshotRef.current !== null || poseRef.current !== null;
        advanceEpoch();
        if (!terminalError) {
          setStatus(ready ? "idle" : "loading");
          setError(hadReference ? "The camera changed or stopped. Find or mark the neck again." : null);
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
      const frame = { canvas, width: canvas.width, height: canvas.height, rgba, capturedAt, mediaTime };
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
      // Copy before transfer: a frozen snapshot must remain intact until seeding is acknowledged.
      const rgba = frame.rgba.slice().buffer;
      flight = { ...operation, frameId: id };
      operationTimer = setTimeout(() => {
        if (!disposed && flight?.frameId === id) fail("Fretboard tracking timed out. Reload to retry; audio practice still works.", true);
      }, 5000);
      try {
        worker.postMessage({ type, epoch, frameId: id, capturedAt: frame.capturedAt, mediaTime: frame.mediaTime,
          width: frame.width, height: frame.height, rgba, points, exclusions: frameExclusions.get(frame) ?? [] }, [rgba]);
      } catch {
        fail("Fretboard tracking could not receive the camera frame. Reload to retry.", true);
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
      if (!active || !current.usable || !current.video || flight || pending || !ready) return;
      if (now - lastSampleAt < FRAME_INTERVAL_MS || current.video.currentTime === lastMediaTime) return;
      try {
        const frame = capture(false);
        if (!frame) return;
        lastSampleAt = frame.capturedAt;
        lastMediaTime = frame.mediaTime;
        send({ type: "frame", epoch, frame });
      } catch {
        fail("The camera frame could not be read. Find or mark the neck again.");
      }
    }

    function freeze(): boolean {
      if (disposed || terminalError) return false;
      advanceEpoch();
      setError(null);
      setStatus("idle");
      try {
        const snapshot = capture(true);
        if (!snapshot) { setError("Wait for a live camera image, then try again."); return false; }
        snapshotRef.current = snapshot;
        setStatus("idle");
        return true;
      } catch {
        fail("The camera frame could not be frozen. Check camera access and try again.");
        return false;
      }
    }

    controlsRef.current = {
      freeze,
      find() {
        if (!freeze()) return;
        pending = { type: "detect", epoch, frame: snapshotRef.current! };
        setStatus("detecting");
        flush();
      },
      seed(points) {
        if (disposed || terminalError) return;
        checkSource();
        const snapshot = snapshotRef.current;
        const copied = pointsFrom(points);
        if (!snapshot || !copied) { fail("Freeze a camera image and mark four neck corners before tracking."); return; }
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
        if (!terminalError) { setError(null); setStatus(ready ? "idle" : "loading"); }
      },
    };

    try {
      worker = new Worker("/vision/fretboard-worker.js");
      loadTimer = setTimeout(() => {
        if (!disposed && !ready) fail("Fretboard tracking could not finish loading. Reload to retry; audio practice still works.", true);
      }, 15000);
      worker.onerror = () => { if (!disposed) fail("Fretboard tracking could not load or stopped unexpectedly. Reload to retry; audio practice still works.", true); };
      worker.onmessage = ({ data }) => {
        if (disposed || !data) return;
        if (data.type === "ready") {
          if (ready || terminalError) return;
          ready = true;
          clearTimeout(loadTimer);
          checkSource();
          worker?.postMessage({ type: "reset", epoch });
          if (!pending) setStatus("idle");
          flush();
          return;
        }
        if (data.type === "error" && data.epoch === undefined) {
          fail(typeof data.message === "string" ? data.message : "Fretboard tracking could not load. Reload to retry.", true);
          return;
        }
        const completed = flight;
        if (!completed || data.epoch !== completed.epoch || data.frameId !== completed.frameId) return;
        flight = null;
        clearTimeout(operationTimer);
        checkSource();
        if (data.epoch !== epoch) { flush(); return; }
        if (data.capturedAt !== completed.frame.capturedAt || data.mediaTime !== completed.frame.mediaTime) {
          if (completed.type !== "frame") fail("Fretboard tracking returned a mismatched camera frame. Find or mark the neck again.");
          flush();
          return;
        }
        if (data.type === "error") {
          if (completed.type === "seed") snapshotRef.current = null;
          fail(typeof data.message === "string" ? data.message : "Fretboard tracking stopped. Find or mark the neck again.");
          return;
        }
        if (completed.type === "detect" && data.type === "detected") {
          const points = pointsFrom(data.proposal?.points);
          if (points && Number.isInteger(data.proposal.wireCount) && data.proposal.wireCount >= 2) {
            setProposal({ points, wireCount: data.proposal.wireCount });
            setStatus("proposal");
          } else {
            setStatus("idle");
            setError("No clear fretboard found. Freeze and mark the neck manually, or adjust the camera and try again.");
          }
        } else if (completed.type === "seed" && data.type === "seeded" && data.status === "tracking") {
          snapshotRef.current = null;
          clearPose();
          active = true;
          lastMediaTime = completed.frame.mediaTime;
          lastSampleAt = -Infinity;
          setStatus("searching");
          sample(performance.now());
        } else if (completed.type === "frame" && data.type === "pose") {
          const age = performance.now() - data.capturedAt;
          const points = pointsFrom(data.points);
          if (!Number.isFinite(age) || age < 0 || age > FRESH_MS || !points
            || (data.status !== "tracking" && data.status !== "reacquired")) {
            clearPose();
            setStatus("searching");
          } else {
            poseRef.current = { points, capturedAt: data.capturedAt, mediaTime: data.mediaTime };
            setStatus("tracking");
            clearTimeout(expiryTimer);
            const acceptedPose = poseRef.current;
            expiryTimer = setTimeout(() => {
              if (disposed || poseRef.current !== acceptedPose) return;
              clearPose();
              if (active) setStatus("searching");
            }, Math.max(1, FRESH_MS + 1 - age));
          }
        } else {
          fail("Fretboard tracking returned an unexpected result. Find or mark the neck again.");
        }
        flush();
      };
    } catch {
      fail("This browser could not start fretboard tracking. Reload or use a browser with Web Worker support.", true);
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      if (poseRef.current && now - poseRef.current.capturedAt > FRESH_MS) {
        clearPose();
        if (active) setStatus("searching");
      }
      checkSource();
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
  return { poseRef, status, error, proposal, snapshotRef, freeze, find, seed, reset };
}
