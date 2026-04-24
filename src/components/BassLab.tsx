"use client";

import { useEffect, useRef, useState } from "react";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import {
  inferFretboard,
  smoothFretboard,
  pixelToFret,
  type HandFretboard,
} from "@/lib/bass/handFretboard";

// MediaPipe fingertip landmark indices
const FINGERTIPS = {
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
} as const;

type FingerName = keyof typeof FINGERTIPS;

const FINGERTIP_COLORS: Record<FingerName, string> = {
  index: "#00FF88",
  middle: "#00DDFF",
  ring: "#FF88DD",
  pinky: "#FFCC00",
};

const FRET_COUNT = 12;
// Diagram string order top→bottom: E (thickest) at top, G (thinnest) at bottom.
// This matches the hand-inferred fretboard's string-axis direction (0=E..3=G).
const STRING_LABELS = ["E", "A", "D", "G"];

type FingerPos = { string: number; fret: number };

export default function BassLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const fretboardCanvasRef = useRef<HTMLCanvasElement>(null);
  const fretboardContainerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [handPosition, setHandPosition] = useState(0);

  const { poseDataRef, isLoading: handsLoading } = usePoseTracking(videoRef);
  const fbRef = useRef<HandFretboard | null>(null);
  const fingerPositionsRef = useRef<Partial<Record<FingerName, FingerPos>>>({});
  const handPositionRef = useRef(handPosition);
  handPositionRef.current = handPosition;

  // Start webcam
  useEffect(() => {
    let stream: MediaStream | null = null;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: isMobile ? 640 : 1280,
            height: isMobile ? 480 : 720,
            facingMode: "user",
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => setWebcamReady(true);
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
    }
    start();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Render loop — two canvases driven by one RAF
  useEffect(() => {
    let rafId = 0;

    function sizeCanvas(
      canvas: HTMLCanvasElement | null,
      container: HTMLDivElement | null
    ) {
      if (!canvas || !container) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return null;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      return { w, h, dpr };
    }

    function drawWebcam(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.clearRect(0, 0, w, h);

      const pose = poseDataRef.current;

      // Keep per-finger (string, fret) in a local ref for the fretboard panel
      const positions: Partial<Record<FingerName, FingerPos>> = {};

      // Update hand-inferred fretboard (used only for finger→string/fret mapping)
      let fb: HandFretboard | null = null;
      if (pose && pose.landmarks.length >= 21) {
        const raw = inferFretboard(pose.landmarks, w, h, true);
        if (raw) {
          fb = smoothFretboard(fbRef.current, raw, 0.35);
          fbRef.current = fb;
        }
      } else if (fbRef.current) {
        fbRef.current = {
          ...fbRef.current,
          confidence: fbRef.current.confidence * 0.9,
        };
        if (fbRef.current.confidence > 0.02) fb = fbRef.current;
        else fbRef.current = null;
      }

      // Fingertip markers + position extraction
      if (pose && pose.landmarks.length >= 21) {
        (Object.keys(FINGERTIPS) as FingerName[]).forEach((name) => {
          const idx = FINGERTIPS[name];
          const lm = pose.landmarks[idx];
          if (!lm) return;
          const px = { x: (1 - lm.x) * w, y: lm.y * h };

          // Outer ring + inner dot
          ctx.strokeStyle = FINGERTIP_COLORS[name];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px.x, px.y, 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = FINGERTIP_COLORS[name];
          ctx.beginPath();
          ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
          ctx.fill();

          if (fb && fb.confidence > 0.15) {
            const fp = pixelToFret(fb, px);
            if (
              fp.fret >= -0.5 &&
              fp.fret <= fb.fretCount + 0.5 &&
              fp.string >= -0.5 &&
              fp.string <= fb.stringCount - 0.5
            ) {
              positions[name] = fp;
            }
          }
        });
      }

      fingerPositionsRef.current = positions;
    }

    function drawFretboard(
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number
    ) {
      ctx.clearRect(0, 0, w, h);

      const padL = 40;
      const padR = 16;
      const padT = 14;
      const padB = 22;
      const boardW = w - padL - padR;
      const boardH = h - padT - padB;
      const fretW = boardW / FRET_COUNT;
      const stringH = boardH / 3; // 4 strings → 3 gaps

      // Fretboard body
      ctx.fillStyle = "#1c1410";
      ctx.fillRect(padL, padT, boardW, boardH);

      // Inlay dots at 3, 5, 7, 9
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      for (const f of [3, 5, 7, 9]) {
        if (f > FRET_COUNT) continue;
        ctx.beginPath();
        ctx.arc(padL + (f - 0.5) * fretW, padT + boardH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Double inlay at 12
      if (FRET_COUNT >= 12) {
        ctx.beginPath();
        ctx.arc(padL + 11.5 * fretW, padT + boardH / 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(padL + 11.5 * fretW, padT + (2 * boardH) / 3, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fret wires
      for (let f = 0; f <= FRET_COUNT; f++) {
        const x = padL + f * fretW;
        ctx.lineWidth = f === 0 ? 3 : 1;
        ctx.strokeStyle =
          f === 0 ? "rgba(255, 255, 255, 0.9)" : "rgba(200, 200, 200, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + boardH);
        ctx.stroke();
      }

      // Strings
      for (let s = 0; s < 4; s++) {
        const y = padT + s * stringH;
        ctx.lineWidth = 2 - s * 0.35; // E (s=0) thickest, G (s=3) thinnest
        ctx.strokeStyle = "rgba(220, 200, 160, 0.7)";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + boardW, y);
        ctx.stroke();

        ctx.fillStyle = "rgba(220, 220, 220, 0.85)";
        ctx.font = "bold 13px monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(STRING_LABELS[s], padL - 8, y);
      }

      // Fret numbers below
      ctx.fillStyle = "rgba(170, 170, 170, 0.7)";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let f = 1; f <= FRET_COUNT; f++) {
        ctx.fillText(f.toString(), padL + (f - 0.5) * fretW, padT + boardH + 4);
      }

      // Finger dots — map hand-local (string, fret) to absolute diagram position
      const positions = fingerPositionsRef.current;
      const base = handPositionRef.current;
      (Object.keys(FINGERTIPS) as FingerName[]).forEach((name) => {
        const fp = positions[name];
        if (!fp) return;
        const sIdx = Math.round(Math.max(0, Math.min(3, fp.string)));
        const absFret = base + fp.fret;
        if (absFret < 0 || absFret > FRET_COUNT) return;

        const x = padL + absFret * fretW;
        const y = padT + sIdx * stringH;

        // Glow
        ctx.fillStyle = FINGERTIP_COLORS[name] + "40";
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        // Dot
        ctx.fillStyle = FINGERTIP_COLORS[name];
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    function tick() {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const wDims = sizeCanvas(webcamCanvasRef.current, webcamContainerRef.current);
      if (wDims) {
        const ctx = webcamCanvasRef.current!.getContext("2d");
        if (ctx) {
          ctx.setTransform(wDims.dpr, 0, 0, wDims.dpr, 0, 0);
          drawWebcam(ctx, wDims.w, wDims.h);
        }
      }

      const fDims = sizeCanvas(
        fretboardCanvasRef.current,
        fretboardContainerRef.current
      );
      if (fDims) {
        const ctx = fretboardCanvasRef.current!.getContext("2d");
        if (ctx) {
          ctx.setTransform(fDims.dpr, 0, 0, fDims.dpr, 0, 0);
          drawFretboard(ctx, fDims.w, fDims.h);
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [poseDataRef]);

  const status = !webcamReady
    ? "Starting webcam..."
    : handsLoading
      ? "Loading hand tracking..."
      : "Finger positions show on the fretboard below";

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden flex flex-col">
      {/* Top header */}
      <div className="relative z-10 p-3 sm:p-4 flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">bass.lab</h1>
          <p className="text-zinc-400 text-xs">{status}</p>
        </div>
        <a
          href="/"
          className="text-xs text-zinc-400 hover:text-white active:scale-95 transition px-3 py-1.5 rounded-full bg-white/10 border border-white/10"
        >
          ← back
        </a>
      </div>

      {/* Webcam panel */}
      <div ref={webcamContainerRef} className="relative flex-1 min-h-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas
          ref={webcamCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      </div>

      {/* Static fretboard panel */}
      <div className="bg-zinc-950/95 border-t border-white/10 flex-shrink-0">
        <div
          ref={fretboardContainerRef}
          className="relative h-36 sm:h-44"
        >
          <canvas ref={fretboardCanvasRef} className="absolute inset-0 w-full h-full" />
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-white/5">
          <label className="text-xs text-zinc-400 font-mono whitespace-nowrap">
            Hand at fret
          </label>
          <input
            type="range"
            min={0}
            max={FRET_COUNT - 3}
            value={handPosition}
            onChange={(e) => setHandPosition(parseInt(e.target.value, 10))}
            className="flex-1 accent-white/70"
          />
          <span className="text-xs font-mono text-white w-6 text-center tabular-nums">
            {handPosition}
          </span>
        </div>
      </div>
    </div>
  );
}
