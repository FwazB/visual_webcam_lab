"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { HandDetection } from "@/hooks/useHandTracking";
import type { GuitarPitch } from "@/hooks/useGuitarPitch";
import { useNeckTracking } from "@/hooks/useNeckTracking";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { midiToName } from "@/lib/instrument/pitch";
import { cameraToImage, cameraViewport, imageToCamera } from "@/lib/instrument/cameraCoordinates";
import { evaluateNeckEvidence, type NeckEvidenceStatus } from "@/lib/instrument/neckEvidence";
import {
  createNeckCalibration, fretCoordinate, locateFingers, neckToImage, positionOnNeck,
  type NeckCalibration, type NeckPoint,
} from "@/lib/instrument/neckMapping";

export interface CameraTarget { string: number; fret: number; midi: number }

interface Props {
  profile: InstrumentProfile;
  videoRef: RefObject<HTMLVideoElement | null>;
  handsRef: RefObject<HandDetection[]>;
  handsUpdatedAtRef: RefObject<number>;
  targetRef: RefObject<CameraTarget | null>;
  pitch: GuitarPitch;
  ready: boolean;
  trackingLoading: boolean;
  trackingError: string | null;
}

const DETAIL: Record<NeckEvidenceStatus, string> = {
  unseen: "Finger position uncertain",
  visible: "Visible placement · waiting for a clear note",
  agrees: "Pitch fits visible placement · contact unverified",
  differs: "Heard pitch differs from visible placement",
  ambiguous: "Multiple possible positions · placement uncertain",
  unsynced: "Sound and hand frames are too far apart to compare",
};

const initialReadout = { seen: "Position uncertain", heard: "Connect guitar", detail: "Map the neck to see finger positions.", target: "", agrees: false };

function cameraTrack(video: HTMLVideoElement | null): MediaStreamTrack | null {
  const source = video?.srcObject;
  return source && "getVideoTracks" in source ? (source as MediaStream).getVideoTracks()[0] ?? null : null;
}

function cameraAvailable(video: HTMLVideoElement | null): boolean {
  const track = cameraTrack(video);
  return !!video && !!video.srcObject && video.readyState >= 2 && !video.paused && !video.ended
    && video.videoWidth > 0 && video.videoHeight > 0 && track?.readyState !== "ended" && track?.enabled !== false && !track?.muted;
}

/** Pixel-based neck tracking with a once-only fret identity anchor. */
export default function RealFretboardOverlay({
  profile, videoRef, handsRef, handsUpdatedAtRef, targetRef, pitch, ready, trackingLoading, trackingError,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markingButtonRef = useRef<HTMLButtonElement>(null);
  const [calibration, setCalibration] = useState<NeckCalibration | null>(null);
  const [marking, setMarking] = useState(false);
  const [points, setPoints] = useState<NeckPoint[]>([]);
  const [firstFret, setFirstFret] = useState(0);
  const [lastFret, setLastFret] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState(initialReadout);
  const [reverseEnds, setReverseEnds] = useState(false);
  const [swapStrings, setSwapStrings] = useState(false);
  const neck = useNeckTracking(videoRef, handsRef, handsUpdatedAtRef);
  const imageSizeRef = useRef<{ width: number; height: number; source: HTMLVideoElement["srcObject"]; track: MediaStreamTrack | null }>({ width: 0, height: 0, source: null, track: null });
  // Cursor coordinates are fractions of the DISPLAY surface; calibration is in sensor coordinates.
  const cursorRef = useRef<NeckPoint>({ x: 0.5, y: 0.5 });
  const lowString = `low ${profile.stringLabels[0]}`;
  const highString = profile.stringCount === 6 ? "high E" : profile.stringLabels[profile.stringCount - 1];
  const wire = (fret: number) => fret === 0 ? "the nut" : `fret ${fret}'s wire`;
  const prompts = [
    `${lowString} string at ${wire(firstFret)}`,
    `${highString} string at ${wire(firstFret)}`,
    `${lowString} string at ${wire(lastFret)}`,
    `${highString} string at ${wire(lastFret)}`,
  ];

  function proposalPoints(): NeckPoint[] {
    let ordered = neck.proposal?.points ?? [];
    if (ordered.length !== 4) return [];
    if (reverseEnds) ordered = [ordered[2], ordered[3], ordered[0], ordered[1]];
    if (swapStrings) ordered = [ordered[1], ordered[0], ordered[3], ordered[2]];
    return ordered;
  }

  function rememberCamera() {
    const video = videoRef.current;
    imageSizeRef.current = { width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0, source: video?.srcObject ?? null, track: cameraTrack(video) };
  }

  function findNeck() {
    setCalibration(null); setMarking(false); setPoints([]); setError(null);
    setReverseEnds(false); setSwapStrings(false);
    rememberCamera();
    neck.find();
  }

  function acceptReference(corners: NeckPoint[]) {
    try {
      const next = createNeckCalibration(corners, firstFret, lastFret, profile);
      neck.seed(corners);
      setCalibration(next); setPoints([]); setMarking(false); setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those corners could not be mapped. Undo a point and try again.");
    }
  }

  function startCalibration() {
    const video = videoRef.current;
    if (!cameraAvailable(video)) { setError("Wait for a live camera image before calibrating."); return; }
    if (!Number.isInteger(firstFret) || !Number.isInteger(lastFret) || firstFret < 0 || lastFret <= firstFret || lastFret > profile.fretCount) {
      setError(`Choose two fret wires from 0 to ${profile.fretCount}, with the last greater than the first.`);
      return;
    }
    if (!neck.freeze()) { setError("Could not capture the camera. Wait for a live image and try again."); return; }
    setCalibration(null);
    setPoints([]);
    setError(null);
    setMarking(true);
    cursorRef.current = { x: 0.5, y: 0.5 };
    rememberCamera();
  }

  function placePoint(displayPoint: NeckPoint) {
    const surface = surfaceRef.current;
    const video = videoRef.current;
    if (!surface || !video || !marking || !ready || !cameraAvailable(video)) return;
    const original = imageSizeRef.current;
    if (original.source !== video.srcObject || original.track !== cameraTrack(video) || original.width !== video.videoWidth || original.height !== video.videoHeight) return;
    const view = cameraViewport(surface.clientWidth, surface.clientHeight, video.videoWidth, video.videoHeight);
    const point = view && cameraToImage(view, displayPoint);
    if (!point) { setError("Choose a point inside the camera image."); return; }
    const next = [...points, point];
    if (next.length < 4) { setPoints(next); setError(null); return; }
    acceptReference(next);
  }

  useEffect(() => {
    if (marking) markingButtonRef.current?.focus();
  }, [marking]);

  useEffect(() => {
    let raf = 0;
    let lastDraw = -Infinity;

    function draw(now: number) {
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      const surface = surfaceRef.current;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const live = cameraAvailable(video);
      const size = imageSizeRef.current;
      const changed = !live || !video || size.width !== video.videoWidth || size.height !== video.videoHeight
        || size.source !== video.srcObject || size.track !== cameraTrack(video);
      const pose = neck.poseRef.current;
      const clock = performance.now();
      const poseAge = pose ? clock - pose.capturedAt : Infinity;
      let activeCalibration: NeckCalibration | null = null;
      if (!changed && calibration && pose && poseAge >= 0 && poseAge <= 250) {
        try { activeCalibration = createNeckCalibration(pose.points, calibration.firstFret, calibration.lastFret, profile); } catch { /* Invalid pose cannot map fingers. */ }
      }
      if ((calibration || marking) && changed) {
        setCalibration(null);
        setMarking(false);
        setPoints([]);
        setError("The camera source changed or stopped. Find or mark the neck again.");
      }
      // Readouts remain live even without a drawable camera (audio practice still works).
      // RAF's timestamp predates other callbacks, including synchronous inference.
      const handAgeMs = clock - handsUpdatedAtRef.current;
      const synchronized = pose !== null && Math.abs(pose.capturedAt - handsUpdatedAtRef.current) <= 100;
      const frame = pitch.frameRef.current;
      const audioAgeMs = pitch.context && frame ? (pitch.context.currentTime - frame.t) * 1000 : Infinity;
      const evidence = evaluateNeckEvidence({
        candidates: activeCalibration && synchronized ? locateFingers(activeCalibration, profile, handsRef.current) : [],
        handAgeMs, audioFrame: frame, audioAgeMs,
        audioRunning: pitch.status === "running" && pitch.context?.state === "running",
        gateDb: pitch.tuning.gateDb, clarityThreshold: pitch.tuning.clarityThreshold,
      });
      const target = targetRef.current;
      const targetPoint = activeCalibration && target ? positionOnNeck(activeCalibration, profile, target.string, target.fret) : null;
      const locations = [...new Set(evidence.candidates.map(c => `${profile.stringLabels[c.string]} fret ${c.fret}`))];
      const next = {
        seen: locations.length ? `Near ${locations.slice(0, 3).join(" / ")}${locations.length > 3 ? " / …" : ""}` : "Position uncertain",
        heard: evidence.heardMidi !== null ? midiToName(evidence.heardMidi) : pitch.status === "running" ? "Waiting for a clear note" : "Connect guitar",
        detail: activeCalibration ? DETAIL[evidence.status] : calibration
          ? neck.status === "searching" ? "Looking for the fretboard · position uncertain" : "Tracking is not active · set up again or follow the error above"
          : "Find or mark the neck to start tracking.",
        target: target ? `${midiToName(target.midi)} · ${profile.stringLabels[target.string]} ${target.fret === 0 ? "open" : `fret ${target.fret}`}${activeCalibration && !targetPoint ? " · outside mapped area" : ""}` : "",
        agrees: evidence.status === "agrees",
      };
      setReadout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      if (!surface || !canvas) return;
      const w = surface.clientWidth, h = surface.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const view = video && live ? cameraViewport(w, h, video.videoWidth, video.videoHeight) : null;
      if (!view) return;
      const snapshot = neck.snapshotRef.current;
      if (snapshot && (marking || neck.proposal || neck.status === "detecting")) {
        ctx.save();
        ctx.translate(view.left + view.width, view.top); ctx.scale(-1, 1);
        ctx.drawImage(snapshot.canvas, 0, 0, view.width, view.height);
        ctx.restore();
      }

      const screen = (point: NeckPoint) => imageToCamera(view, point);
      function line(a: NeckPoint | null, b: NeckPoint | null, color: string, width = 1) {
        if (!a || !b) return;
        const from = screen(a), to = screen(b);
        ctx!.strokeStyle = color;
        ctx!.lineWidth = width;
        ctx!.beginPath(); ctx!.moveTo(from.x, from.y); ctx!.lineTo(to.x, to.y); ctx!.stroke();
      }
      function label(text: string, point: NeckPoint, color = "#ffffff") {
        ctx!.font = "12px monospace";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        const half = ctx!.measureText(text).width / 2 + 6;
        const x = Math.max(half, Math.min(w - half, point.x));
        const y = Math.max(12, Math.min(h - 12, point.y));
        ctx!.lineWidth = 4;
        ctx!.strokeStyle = "#000000";
        ctx!.strokeText(text, x, y);
        ctx!.fillStyle = color;
        ctx!.fillText(text, x, y);
      }

      if (activeCalibration) {
        for (let string = 0; string < profile.stringCount; string++) {
          const y = string / (profile.stringCount - 1);
          line(neckToImage(activeCalibration, { x: 0, y }), neckToImage(activeCalibration, { x: 1, y }), "rgba(255,255,255,0.45)");
        }
        for (let fret = activeCalibration.firstFret; fret <= activeCalibration.lastFret; fret++) {
          const x = fretCoordinate(activeCalibration, fret);
          const low = neckToImage(activeCalibration, { x, y: 0 });
          line(low, neckToImage(activeCalibration, { x, y: 1 }), "rgba(255,255,255,0.32)");
          if (low && (fret === activeCalibration.firstFret || fret === activeCalibration.lastFret || fret % 2 === 1)) {
            const p = screen(low);
            label(String(fret), { x: p.x, y: p.y - 18 }, "#dedede");
          }
        }
        if (targetPoint) {
          const p = screen(targetPoint);
          ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          label(target!.fret === 0 ? "Open" : midiToName(target!.midi), { x: p.x, y: p.y + 29 }, "#ffcc00");
        }
        const drawn = new Set<string>();
        for (const candidate of evidence.candidates) {
          const key = `${candidate.handIndex}:${candidate.finger}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const p = screen(candidate.point);
          ctx.fillStyle = evidence.status === "agrees" ? "#6ee7b7" : "#67e8f9";
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          label(String(candidate.finger), { x: p.x + 13, y: p.y - 13 }, "#a5f3fc");
        }
      }
      if (marking && !changed) {
        points.forEach((point, i) => {
          const p = screen(point);
          ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
          label(String(i + 1), { x: p.x, y: p.y - 20 }, "#ffcc00");
        });
        const p = { x: cursorRef.current.x * w, y: cursorRef.current.y * h };
        ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y);
        ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y + 10); ctx.stroke();
      }

      if (neck.proposal && !changed) {
        let outline = neck.proposal.points;
        if (reverseEnds) outline = [outline[2], outline[3], outline[0], outline[1]];
        if (swapStrings) outline = [outline[1], outline[0], outline[3], outline[2]];
        const polygon = [outline[0], outline[2], outline[3], outline[1]];
        polygon.forEach((point, i) => line(point, polygon[(i + 1) % 4], "#67e8f9", 2));
        outline.forEach((point, i) => {
          const p = screen(point);
          label(`${i % 2 ? "High" : "Low"} · wire ${i < 2 ? firstFret : lastFret}`, { x: p.x, y: p.y - 16 }, "#67e8f9");
        });
      }

    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [calibration, marking, points, handsRef, handsUpdatedAtRef, targetRef, pitch, profile, videoRef, neck, reverseEnds, swapStrings, firstFret, lastFret]);

  return (
    <div className="flex flex-col bg-zinc-950">
      <div className="border-b border-white/10 bg-zinc-950 px-3 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">Real fretboard <span className="text-zinc-400 text-xs">· tracking preview</span></span>
          {calibration && <button type="button" onClick={() => { neck.reset(); setCalibration(null); setError(null); }} className="rounded-md bg-white/10 px-3 py-2 text-xs hover:bg-white/20">Set up again</button>}
        </div>
        {calibration ? (
          <p role="status" className="mt-1 text-xs text-zinc-300">{neck.status === "tracking" ? "Following the neck" : neck.status === "searching" ? "Looking for the same neck" : "Tracking stopped · set up again or follow the error below"} · frets {calibration.firstFret}–{calibration.lastFret}. Keep the mapped section visible.</p>
        ) : marking ? (
          <>
            <p aria-live="polite" className="mt-2 text-yellow-200">{points.length + 1}/4 · Tap {prompts[points.length]}.</p>
            <p className="mt-1 text-xs text-zinc-400">Frozen image · mark this snapshot once. Arrow keys move the crosshair; Enter marks it.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={!points.length} onClick={() => { setPoints(previous => previous.slice(0, -1)); setError(null); }} className="rounded bg-white/10 px-3 py-2 text-xs disabled:opacity-40">Undo point</button>
              <button type="button" onClick={() => { neck.reset(); setMarking(false); setPoints([]); setError(null); }} className="rounded bg-white/10 px-3 py-2 text-xs">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-zinc-300">{neck.proposal
              ? `Check the outline on this snapshot (${neck.proposal.wireCount} detected wires). Confirm the low/high string edges and actual fret numbers once.`
              : neck.status === "detecting" ? "Finding a neck outline in this snapshot…"
              : "Show a clear stretch of neck. Find its outline automatically or mark it once; tracking then follows your movement."}</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs text-zinc-300">First wire (0 = nut)<input type="number" min={0} max={profile.fretCount - 1} value={Number.isNaN(firstFret) ? "" : firstFret} onChange={event => setFirstFret(event.target.valueAsNumber)} className="mt-1 block w-24 rounded border border-white/20 bg-zinc-900 px-2 py-2 text-base text-white" /></label>
              <label className="text-xs text-zinc-300">Last wire<input type="number" min={1} max={profile.fretCount} value={Number.isNaN(lastFret) ? "" : lastFret} onChange={event => setLastFret(event.target.valueAsNumber)} className="mt-1 block w-24 rounded border border-white/20 bg-zinc-900 px-2 py-2 text-base text-white" /></label>
              {neck.proposal ? (
                <>
                  <button type="button" onClick={() => setReverseEnds(value => !value)} className="rounded bg-white/10 px-3 py-2.5 text-xs">Reverse ends</button>
                  <button type="button" onClick={() => setSwapStrings(value => !value)} className="rounded bg-white/10 px-3 py-2.5 text-xs">Swap string sides</button>
                  <button type="button" onClick={() => acceptReference(proposalPoints())} className="rounded bg-yellow-300 px-3 py-2.5 text-xs font-medium text-black">Use this outline</button>
                </>
              ) : (
                <button type="button" disabled={!ready || neck.status === "loading" || neck.status === "detecting"} onClick={findNeck} className="rounded-md bg-yellow-300 px-3 py-2.5 text-xs font-medium text-black disabled:opacity-40">{neck.status === "loading" ? "Loading tracker…" : "Find fretboard"}</button>
              )}
              <button type="button" disabled={!ready} onClick={startCalibration} className="rounded-md bg-white/10 px-3 py-2.5 text-xs disabled:opacity-40">Mark manually</button>
              {(neck.proposal || neck.status === "detecting") && <button type="button" onClick={() => neck.reset()} className="rounded bg-white/10 px-3 py-2.5 text-xs">Cancel</button>}
            </div>
            <p className="mt-2 text-xs text-zinc-400">Use 0 only for the nut. Automatic outline detection does not identify fret numbers or string order.</p>
          </>
        )}
        {(error || neck.error) && <p role="alert" className="mt-2 text-xs text-amber-200">{neck.error ?? error}</p>}
      </div>
      <div ref={surfaceRef} className="relative h-[54vh] min-h-[260px] sm:min-h-[380px] bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain -scale-x-100" />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
      {marking && (
        <button
          ref={markingButtonRef}
          type="button"
          className="absolute inset-0 w-full h-full cursor-crosshair pointer-events-auto focus-visible:outline-2 focus-visible:outline-yellow-300 focus-visible:-outline-offset-4"
          aria-label={`Mark point ${points.length + 1}: ${prompts[points.length]}. Use arrow keys to move the crosshair and Enter to mark. Escape cancels.`}
          onPointerMove={event => {
            const box = event.currentTarget.getBoundingClientRect();
            cursorRef.current = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
          }}
          onClick={event => {
            const box = event.currentTarget.getBoundingClientRect();
            placePoint(event.detail === 0
              ? { x: cursorRef.current.x * box.width, y: cursorRef.current.y * box.height }
              : { x: event.clientX - box.left, y: event.clientY - box.top });
          }}
          onKeyDown={event => {
            if (event.key === "Escape") { neck.reset(); setMarking(false); setPoints([]); setError(null); }
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const step = event.shiftKey ? 0.002 : 0.01;
            const { x, y } = cursorRef.current;
            cursorRef.current = {
              x: Math.max(0, Math.min(1, x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
              y: Math.max(0, Math.min(1, y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))),
            };
          }}
        />
      )}
      </div>
      {!marking && !neck.proposal && neck.status !== "detecting" && (
        <div className="border-t border-white/10 bg-zinc-950 px-3 py-2.5 text-sm">
          {readout.target && <p className="mb-2 text-xs text-yellow-200">○ Target {readout.target}</p>}
          <p><span className="text-zinc-400">Seen</span> · {trackingError ? "Tracking unavailable" : trackingLoading ? "Loading hand tracking…" : readout.seen}</p>
          <p className="mt-1"><span className="text-zinc-400">Heard</span> · {readout.heard}</p>
          <p role="status" className={`mt-2 text-xs ${readout.agrees ? "text-emerald-200" : "text-zinc-300"}`}>{trackingError ?? readout.detail}</p>
          {calibration && <p className="mt-1 text-[11px] text-zinc-400">Ring = target · dots = estimated fingertips · single notes</p>}
        </div>
      )}
    </div>
  );
}
