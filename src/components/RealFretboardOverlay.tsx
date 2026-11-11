"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { HandDetection } from "@/hooks/useHandTracking";
import type { GuitarPitch } from "@/hooks/useGuitarPitch";
import { useNeckTracking, type NeckCameraIdentity, type NeckProposal } from "@/hooks/useNeckTracking";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { midiToName } from "@/lib/instrument/pitch";
import { cameraViewport, imageToCamera } from "@/lib/instrument/cameraCoordinates";
import { readHeardMidi } from "@/lib/instrument/neckEvidence";
import { createNeckGeometry, imageToNeck, neckToImage, type NeckGeometry, type NeckPoint } from "@/lib/instrument/neckMapping";

export interface CameraTarget { string: number; fret: number; midi: number }

interface Props {
  compact?: boolean;
  profile: InstrumentProfile;
  videoRef: RefObject<HTMLVideoElement | null>;
  handsRef: RefObject<HandDetection[]>;
  handsUpdatedAtRef: RefObject<number>;
  targetRef: RefObject<CameraTarget | null>;
  pitch: GuitarPitch;
  ready: boolean;
  trackingLoading: boolean;
  trackingError: string | null;
  onRetryHandTracking?: () => void;
}

type CameraIdentity = NeckCameraIdentity;
interface FretSegment { a: NeckPoint; b: NeckPoint }
interface Reference { camera: CameraIdentity; frets: FretSegment[] }
const FINGERS = [{ index: 4, name: "Thumb" }, { index: 8, name: "Index" }, { index: 12, name: "Middle" },
  { index: 16, name: "Ring" }, { index: 20, name: "Little" }];
const HAND_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [17, 0]];
const initialReadout = { seen: "No fresh hands visible", heard: "Connect guitar", detail: "Looking for visible frets · hand landmarks remain live.", target: "" };

function cameraIdentity(video: HTMLVideoElement | null): CameraIdentity | null {
  if (!video) return null;
  const source = video.srcObject;
  const track = source && "getVideoTracks" in source ? (source as MediaStream).getVideoTracks()[0] ?? null : null;
  return { video, source, track, width: video.videoWidth, height: video.videoHeight };
}
function sameCamera(a: CameraIdentity | null, b: CameraIdentity | null): boolean {
  return !!a && !!b && a.video === b.video && a.source === b.source && a.track === b.track && a.width === b.width && a.height === b.height;
}
function cameraAvailable(camera: CameraIdentity | null): boolean {
  return !!camera && !!camera.source && camera.video.readyState >= 2 && !camera.video.paused && !camera.video.ended
    && camera.width > 0 && camera.height > 0 && camera.track?.readyState === "live" && camera.track.enabled !== false && !camera.track.muted;
}
function validPoint(point: { x: number; y: number; z?: number } | undefined): point is NeckPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && (point.z === undefined || Number.isFinite(point.z));
}

function referenceFromProposal(proposal: NeckProposal, camera: CameraIdentity): Reference {
  const geometry = createNeckGeometry(proposal.points);
  const frets = proposal.frets.map(({ a, b }) => {
    const first = imageToNeck(geometry, a), last = imageToNeck(geometry, b);
    if (!first || !last) throw new Error("The detected frets did not fit the neck. Waiting for a fresh detection.");
    return { a: first, b: last };
  });
  if (frets.length < 2) throw new Error("Show several visible fret lines and try again.");
  return { camera, frets };
}

/** Live hand landmarks plus observed neck geometry; no invented fret identities. */
export default function RealFretboardOverlay({
  compact = false, profile, videoRef, handsRef, handsUpdatedAtRef, targetRef, pitch, ready, trackingLoading, trackingError, onRetryHandTracking,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const referenceRef = useRef<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState(initialReadout);
  const neck = useNeckTracking(videoRef, handsRef, handsUpdatedAtRef);
  const acceptedProposalRef = useRef<typeof neck.proposal>(null);
  const acceptedReplacementRef = useRef<typeof neck.replacementRef.current>(null);
  const observedCameraRef = useRef<CameraIdentity | null>(null);
  const cameraWasLiveRef = useRef(false);
  const blockedHandsThroughRef = useRef(-Infinity);

  function updateReference(next: Reference | null) {
    referenceRef.current = next;
    setReference(next);
  }

  function toggleTracking() {
    if (neck.status === "paused" || neck.status === "error") neck.resume();
    else neck.pause();
    acceptedProposalRef.current = null;
    acceptedReplacementRef.current = null;
    updateReference(null);
    setError(null);
  }

  useEffect(() => {
    const proposal = neck.proposal;
    if (!proposal || acceptedProposalRef.current === proposal) return;
    acceptedProposalRef.current = proposal;
    const camera = cameraIdentity(videoRef.current);
    try {
      if (!ready || !cameraAvailable(camera) || !sameCamera(camera, neck.snapshotRef.current?.camera ?? null)) {
        throw new Error("The camera changed or stopped. Waiting for a fresh image.");
      }
      updateReference(referenceFromProposal(proposal, camera!));
      acceptedReplacementRef.current = null;
      setError(null);
      neck.seed(proposal.points);
    } catch (cause) {
      neck.reset();
      updateReference(null);
      setError(cause instanceof Error ? cause.message : "The fretboard could not be tracked. Try finding it again.");
    }
  }, [neck, neck.proposal, ready, videoRef]);

  useEffect(() => {
    let raf = 0;
    let lastDraw = -Infinity;
    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      const camera = cameraIdentity(videoRef.current);
      const live = ready && cameraAvailable(camera);
      const clock = performance.now();
      const previousCamera = observedCameraRef.current;
      const sourceChanged = previousCamera !== null && !sameCamera(previousCamera, camera);
      if (sourceChanged || (cameraWasLiveRef.current && !live)) blockedHandsThroughRef.current = handsUpdatedAtRef.current;
      observedCameraRef.current = camera;
      cameraWasLiveRef.current = live;
      let drawingReference = referenceRef.current;
      const replacement = neck.replacementRef.current;
      if (replacement && replacement !== acceptedReplacementRef.current) {
        acceptedReplacementRef.current = replacement;
        if (live && sameCamera(replacement.camera, camera)) {
          try {
            // The worker has already seeded this wider reference. Adopt its
            // frets before drawing its pose, without another seed or stale grid.
            drawingReference = referenceFromProposal(replacement.proposal, replacement.camera);
            updateReference(drawingReference);
          } catch {
            neck.reset();
            drawingReference = null;
            updateReference(null);
          }
        }
      }
      const changed = !!drawingReference && (!live || !sameCamera(drawingReference.camera, camera));
      if (changed) {
        blockedHandsThroughRef.current = handsUpdatedAtRef.current;
        updateReference(null);
        setError(null);
      }
      const pose = neck.poseRef.current;
      const poseAge = pose ? clock - pose.capturedAt : Infinity;
      let geometry: NeckGeometry | null = null;
      if (drawingReference && !changed && neck.status === "tracking" && pose && poseAge >= 0 && poseAge <= 250) {
        try { geometry = createNeckGeometry(pose.points); } catch { /* An invalid pose never draws a grid. */ }
      }
      // Inference timestamps use performance.now(), which can be later than RAF's timestamp.
      const handAgeMs = clock - handsUpdatedAtRef.current;
      const handsFresh = live && !trackingLoading && !trackingError && handAgeMs >= 0 && handAgeMs <= 250
        && handsUpdatedAtRef.current > blockedHandsThroughRef.current;
      const hands = handsFresh ? handsRef.current : [];
      const synchronized = !!pose && Math.abs(pose.capturedAt - handsUpdatedAtRef.current) <= 100;
      const placements = hands.flatMap((hand, handIndex) => FINGERS.flatMap(finger => {
        const point = hand.landmarks[finger.index];
        return geometry && synchronized && validPoint(point) && imageToNeck(geometry, point)
          ? [{ handIndex, index: finger.index, name: finger.name, point }] : [];
      }));
      const frame = pitch.frameRef.current;
      const audioAgeMs = pitch.context && frame ? (pitch.context.currentTime - frame.t) * 1000 : Infinity;
      const heardMidi = readHeardMidi({ audioFrame: frame, audioAgeMs,
        audioRunning: pitch.status === "running" && pitch.context?.state === "running",
        gateDb: pitch.tuning.gateDb, clarityThreshold: pitch.tuning.clarityThreshold });
      const names = [...new Set(placements.map(placement => placement.name))];
      const target = targetRef.current;
      const next = {
        seen: names.length ? `${names.join(" / ")} visible on neck` : hands.length ? "Hand landmarks visible" : "No fresh hands visible",
        heard: heardMidi !== null ? midiToName(heardMidi) : pitch.status === "running" ? "Waiting for a clear note" : "Connect guitar",
        detail: geometry
          ? "Cyan fingertips overlap the neck in the camera image · string contact is not measured."
          : neck.status === "paused" ? "Neck tracking paused · hand landmarks remain live."
            : neck.status === "error" ? "Neck tracking stopped · retry neck tracking. Hand landmarks remain live."
              : "Looking for visible frets · hand landmarks remain live.",
        target: target ? `${midiToName(target.midi)} · ${profile.stringLabels[target.string]} ${target.fret === 0 ? "open" : `fret ${target.fret}`}` : "",
      };
      setReadout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      const surface = surfaceRef.current, canvas = canvasRef.current;
      if (!surface || !canvas) return;
      const w = surface.clientWidth, h = surface.clientHeight, dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const view = camera && live ? cameraViewport(w, h, camera.width, camera.height) : null;
      if (!view) return;
      const screen = (point: NeckPoint) => imageToCamera(view, point);
      function line(a: NeckPoint | null, b: NeckPoint | null, color: string, width = 1) {
        if (!a || !b) return;
        const from = screen(a), to = screen(b);
        ctx!.strokeStyle = color; ctx!.lineWidth = width;
        ctx!.beginPath(); ctx!.moveTo(from.x, from.y); ctx!.lineTo(to.x, to.y); ctx!.stroke();
      }
      function dot(point: NeckPoint, radius: number, color: string) {
        const p = screen(point);
        ctx!.fillStyle = color; ctx!.strokeStyle = "#000000"; ctx!.lineWidth = 1.5;
        ctx!.beginPath(); ctx!.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx!.fill(); ctx!.stroke();
      }
      if (geometry && drawingReference) {
        // Keep the supported boundary readable against both dark wood and
        // reflections. This spans the observed section, not an assumed neck length.
        const boundary = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
          .map(point => neckToImage(geometry, point));
        if (boundary.every(point => point !== null)) {
          ctx.beginPath();
          boundary.forEach((point, index) => {
            const p = screen(point!);
            if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.fillStyle = "rgba(250,204,21,0.06)";
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.lineWidth = 5; ctx.stroke();
          ctx.strokeStyle = "rgba(250,204,21,0.95)"; ctx.lineWidth = 2; ctx.stroke();
        }
        for (let string = 0; string < profile.stringCount; string++) {
          const y = string / (profile.stringCount - 1);
          line(neckToImage(geometry, { x: 0, y }), neckToImage(geometry, { x: 1, y }), "rgba(255,255,255,0.75)", 1.5);
        }
        for (const fret of drawingReference.frets) {
          const a = neckToImage(geometry, fret.a), b = neckToImage(geometry, fret.b);
          line(a, b, "rgba(0,0,0,0.55)", 3.5);
          line(a, b, "rgba(250,204,21,0.8)", 1.5);
        }
      }
      hands.forEach((hand, handIndex) => {
        for (const [a, b] of HAND_CONNECTIONS) {
          if (validPoint(hand.landmarks[a]) && validPoint(hand.landmarks[b])) line(hand.landmarks[a], hand.landmarks[b], "rgba(196,181,253,0.65)", 1.5);
        }
        hand.landmarks.forEach((point, index) => {
          if (!validPoint(point)) return;
          const onNeck = placements.some(placement => placement.handIndex === handIndex && placement.index === index);
          const fingertip = FINGERS.find(finger => finger.index === index);
          const color = onNeck ? "#67e8f9" : "#c4b5fd";
          dot(point, onNeck ? 6 : fingertip ? 4 : 2.5, color);
        });
      });
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reference, ready, trackingLoading, trackingError, handsRef, handsUpdatedAtRef, targetRef, pitch, profile, videoRef, neck]);

  return (
    <div className="flex flex-col bg-zinc-950">
      <div className="border-b border-white/10 bg-zinc-950 px-3 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Real fretboard <span className="text-zinc-400 text-xs">· {profile.stringCount} strings</span></span>
          <button type="button" onClick={toggleTracking} className="rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20">
            {neck.status === "paused" ? "Resume neck tracking" : neck.status === "error" ? "Retry neck tracking" : "Pause neck tracking"}
          </button>
        </div>
        <p role="status" className="mt-1 text-xs text-zinc-300">{neck.status === "paused" ? "Neck tracking paused. Your camera and hand landmarks remain live."
          : neck.status === "error" ? "Neck tracking stopped. Hand tracking and audio remain independent."
            : !ready ? "Waiting for the camera. Neck detection starts automatically."
              : neck.status === "loading" ? "Loading neck tracking · your camera stays live."
                : reference && neck.status === "tracking" ? `Tracking the visible section · ${reference.frets.length} observed fret lines`
                  : "Looking for the fretboard automatically. Show a clear stretch of neck with visible frets."}</p>
        {(error || neck.error) && <p role="alert" className="mt-2 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">{neck.error ?? error}</p>}
      </div>
      <div ref={surfaceRef} className={compact ? "relative h-[30vh] min-h-[200px] lg:h-[52vh] bg-black" : "relative h-[54vh] min-h-[260px] sm:min-h-[380px] bg-black"}>
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain -scale-x-100" />
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
      </div>
      <div className="border-t border-white/10 bg-zinc-950 px-3 py-2.5 text-sm">
        {readout.target && <p className="mb-2 text-xs text-yellow-200">Target · {readout.target}</p>}
        <p><span className="text-zinc-400">Seen</span> · {trackingError ? "Tracking unavailable" : trackingLoading ? "Loading hand tracking…" : readout.seen}</p>
        {trackingError && onRetryHandTracking && <button type="button" onClick={onRetryHandTracking} className="mt-2 rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20">Retry hand tracking</button>}
        <p className="mt-1"><span className="text-zinc-400">Heard</span> · {readout.heard}</p>
        {compact ? <details className="mt-2 text-xs text-zinc-400"><summary className="cursor-pointer">Tracking details</summary>
          <p role="status" className="mt-1">{trackingError ?? readout.detail}</p>
          <p className="mt-1">Yellow outline and observed frets · white string guides · purple hands · cyan fingertips over the neck.</p>
          <p className="mt-1">The outline can grow as more frets become visible.</p>
          <p className="mt-1">Fret numbers and string pitches are not inferred from the camera.</p>
        </details> : <>
          <p role="status" className="mt-2 text-xs text-zinc-300">{trackingError ?? readout.detail}</p>
          <p className="mt-1 text-[11px] text-zinc-400">White = {profile.stringCount}-string guide · yellow = outline and observed frets · purple = hand landmarks · cyan = fingertips over the neck</p>
          <p className="mt-1 text-[11px] text-zinc-400">The outline can grow as more frets become visible.</p>
          <p className="mt-1 text-[11px] text-zinc-500">Fret numbers and string pitches are not inferred from this camera outline.</p>
        </>}
      </div>
    </div>
  );
}
