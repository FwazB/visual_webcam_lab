"use client";

import { useEffect, useRef, useState } from "react";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import {
  inferFretboard,
  smoothFretboard,
  fretToPixel,
  pixelToFret,
  type HandFretboard,
  type Point,
} from "@/lib/bass/handFretboard";

// MediaPipe fingertip landmark indices
const FINGERTIPS = {
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
} as const;

const FINGERTIP_COLORS = {
  index: "#00FF88",
  middle: "#00DDFF",
  ring: "#FF88DD",
  pinky: "#FFCC00",
};

export default function BassLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);

  const { poseDataRef, isLoading: handsLoading } = usePoseTracking(videoRef);
  const fretboardRef = useRef<HandFretboard | null>(null);

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

  // Render loop — hand-inferred fretboard + fingertip overlay
  useEffect(() => {
    let rafId = 0;

    function sizeCanvas() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      return { w, h, dpr };
    }

    function draw() {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const dims = sizeCanvas();
      if (!dims) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      const { w, h, dpr } = dims;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Infer fretboard from current hand landmarks
      const pose = poseDataRef.current;
      let fb: HandFretboard | null = null;
      if (pose && pose.landmarks.length >= 21) {
        const raw = inferFretboard(pose.landmarks, w, h, true);
        if (raw) {
          fb = smoothFretboard(fretboardRef.current, raw, 0.35);
          fretboardRef.current = fb;
        }
      } else {
        // Slowly fade confidence when no hand is present
        if (fretboardRef.current) {
          fretboardRef.current = {
            ...fretboardRef.current,
            confidence: fretboardRef.current.confidence * 0.9,
          };
          if (fretboardRef.current.confidence > 0.02) fb = fretboardRef.current;
          else fretboardRef.current = null;
        }
      }

      // Draw fretboard grid
      if (fb && fb.confidence > 0.15) {
        const alpha = Math.min(1, fb.confidence * 1.5);

        // Fret lines (perpendicular to neck axis)
        ctx.lineWidth = 1.5;
        for (let f = 0; f <= fb.fretCount; f++) {
          const isEdge = f === 0 || f === fb.fretCount;
          ctx.strokeStyle = isEdge
            ? `rgba(255, 220, 0, ${0.85 * alpha})`
            : `rgba(255, 255, 255, ${0.28 * alpha})`;
          const pTop = fretToPixel(fb, f, 0);
          const pBot = fretToPixel(fb, f, fb.stringCount - 1);
          ctx.beginPath();
          ctx.moveTo(pTop.x, pTop.y);
          ctx.lineTo(pBot.x, pBot.y);
          ctx.stroke();
        }

        // String lines (along neck axis)
        const stringLabels = ["E", "A", "D", "G"];
        for (let s = 0; s < fb.stringCount; s++) {
          const isEdge = s === 0 || s === fb.stringCount - 1;
          ctx.strokeStyle = `rgba(200, 220, 255, ${(isEdge ? 0.55 : 0.35) * alpha})`;
          ctx.lineWidth = isEdge ? 1.5 : 1;
          const pStart = fretToPixel(fb, 0, s);
          const pEnd = fretToPixel(fb, fb.fretCount, s);
          ctx.beginPath();
          ctx.moveTo(pStart.x, pStart.y);
          ctx.lineTo(pEnd.x, pEnd.y);
          ctx.stroke();

          ctx.fillStyle = `rgba(200, 220, 255, ${0.9 * alpha})`;
          ctx.font = "bold 12px monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(stringLabels[s] ?? "", pStart.x - 6, pStart.y);
        }

        // Grid cell dots (faint) to make the 4x4 space readable
        for (let f = 0; f < fb.fretCount; f++) {
          for (let s = 0; s < fb.stringCount; s++) {
            const mid = fretToPixel(fb, f + 0.5, s);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.12 * alpha})`;
            ctx.beginPath();
            ctx.arc(mid.x, mid.y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Draw fingertip markers
      if (fb && pose && pose.landmarks.length >= 21) {
        const drawFinger = (idx: number, name: keyof typeof FINGERTIP_COLORS) => {
          const lm = pose.landmarks[idx];
          if (!lm) return;
          const px: Point = { x: (1 - lm.x) * w, y: lm.y * h };
          const fp = pixelToFret(fb!, px);
          const onBoard =
            fp.fret >= -0.5 &&
            fp.fret <= fb!.fretCount + 0.5 &&
            fp.string >= -0.5 &&
            fp.string <= fb!.stringCount - 0.5;

          // Outer ring
          ctx.strokeStyle = FINGERTIP_COLORS[name];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px.x, px.y, 12, 0, Math.PI * 2);
          ctx.stroke();
          // Inner dot
          ctx.fillStyle = FINGERTIP_COLORS[name];
          ctx.beginPath();
          ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
          ctx.fill();

          if (onBoard) {
            const sIdx = Math.round(Math.max(0, Math.min(fb!.stringCount - 1, fp.string)));
            const fIdx = Math.round(Math.max(0, Math.min(fb!.fretCount, fp.fret)));
            const stringName = ["E", "A", "D", "G"][sIdx] ?? "?";
            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
            ctx.fillRect(px.x + 14, px.y - 9, 50, 18);
            ctx.fillStyle = FINGERTIP_COLORS[name];
            ctx.font = "bold 11px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${stringName} f${fIdx}`, px.x + 18, px.y);
          }
        };

        drawFinger(FINGERTIPS.index, "index");
        drawFinger(FINGERTIPS.middle, "middle");
        drawFinger(FINGERTIPS.ring, "ring");
        drawFinger(FINGERTIPS.pinky, "pinky");
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [poseDataRef]);

  const status = !webcamReady
    ? "Starting webcam..."
    : handsLoading
      ? "Loading hand tracking..."
      : "Move your fretting hand into view — grid follows automatically";

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      <div ref={containerRef} className="absolute inset-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">bass.lab</h1>
          <p className="text-zinc-400 text-xs">{status}</p>
        </div>
        <a
          href="/"
          className="pointer-events-auto text-xs text-zinc-400 hover:text-white active:scale-95 transition px-3 py-1.5 rounded-full bg-white/10 border border-white/10"
        >
          ← back
        </a>
      </div>

      {/* Bottom hint */}
      {webcamReady && !handsLoading && (
        <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 text-center pointer-events-none px-4">
          <p className="text-zinc-500 text-[11px] max-w-xs">
            4-fret × 4-string grid auto-aligns to your hand. Shapes & matching coming in sprint 2.
          </p>
        </div>
      )}
    </div>
  );
}
