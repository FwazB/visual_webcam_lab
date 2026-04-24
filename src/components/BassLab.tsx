"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import { useFretboardCalibration } from "@/hooks/useFretboardCalibration";
import { fretToPixel, pixelToFret, type Point } from "@/lib/bass/homography";

// MediaPipe hand landmark indices for fingertips
const FINGERTIPS = {
  thumb: 4,
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

const CALIB_COLORS = ["#FF4466", "#FF8844", "#44FF88", "#44AAFF"];

export default function BassLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);

  const { poseDataRef, isLoading: handsLoading } = usePoseTracking(videoRef);
  const {
    points,
    step,
    isComplete,
    currentLabel,
    homography,
    addPoint,
    undo,
    reset,
  } = useFretboardCalibration();

  // Store latest refs so RAF loop reads fresh values without re-binding
  const homographyRef = useRef(homography);
  homographyRef.current = homography;
  const pointsRef = useRef(points);
  pointsRef.current = points;

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

  // Render loop — draws calibration dots, fretboard grid, fingertip markers
  useEffect(() => {
    let rafId = 0;

    function sizeCanvas() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
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

      const h13 = homographyRef.current;

      // -- Fretboard grid (if calibrated) --
      if (h13) {
        // Fret lines (vertical relative to neck)
        ctx.lineWidth = 1.5;
        for (let f = 0; f <= 12; f++) {
          const isOctave = f === 0 || f === 12;
          const isMarker = [3, 5, 7, 9].includes(f);
          ctx.strokeStyle = isOctave
            ? "rgba(255, 220, 0, 0.9)"
            : isMarker
              ? "rgba(255, 255, 255, 0.55)"
              : "rgba(255, 255, 255, 0.22)";
          const pTop = fretToPixel(h13, f, 0);
          const pBot = fretToPixel(h13, f, 3);
          ctx.beginPath();
          ctx.moveTo(pTop.x, pTop.y);
          ctx.lineTo(pBot.x, pBot.y);
          ctx.stroke();

          // Fret number label
          if (f === 0 || isOctave || isMarker) {
            ctx.fillStyle = "rgba(255, 220, 0, 0.85)";
            ctx.font = "bold 11px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(f.toString(), pTop.x, pTop.y + 4);
          }
        }

        // String lines
        const stringLabels = ["E", "A", "D", "G"];
        for (let s = 0; s < 4; s++) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
          ctx.lineWidth = s === 0 || s === 3 ? 1.5 : 1;
          const pStart = fretToPixel(h13, 0, s);
          const pEnd = fretToPixel(h13, 12, s);
          ctx.beginPath();
          ctx.moveTo(pStart.x, pStart.y);
          ctx.lineTo(pEnd.x, pEnd.y);
          ctx.stroke();

          // String label at nut side
          ctx.fillStyle = "rgba(200, 220, 255, 0.85)";
          ctx.font = "bold 12px monospace";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(stringLabels[s], pStart.x - 6, pStart.y);
        }

        // Position inlays at traditional fret markers (single dot at 3,5,7,9; double at 12)
        const inlayFrets = [3, 5, 7, 9];
        for (const f of inlayFrets) {
          const mid = fretToPixel(h13, f - 0.5, 1.5);
          ctx.fillStyle = "rgba(255, 220, 0, 0.35)";
          ctx.beginPath();
          ctx.arc(mid.x, mid.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // -- Calibration dots (user's taps so far) --
      pointsRef.current.forEach((p, i) => {
        ctx.fillStyle = CALIB_COLORS[i] ?? "white";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();
        // Number label
        ctx.fillStyle = "white";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((i + 1).toString(), p.x, p.y);
      });

      // Connect the dots if we have 2+ (polygon preview)
      if (pointsRef.current.length >= 2) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        pointsRef.current.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (pointsRef.current.length === 4) ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // -- Fingertip markers + fret coords (if calibrated and hand visible) --
      const pose = poseDataRef.current;
      if (h13 && pose && pose.landmarks.length > 0) {
        const landmarks = pose.landmarks;
        const drawFinger = (idx: number, name: keyof typeof FINGERTIP_COLORS) => {
          const lm = landmarks[idx];
          if (!lm) return;
          // Un-mirror X because the video is CSS-flipped
          const px: Point = {
            x: (1 - lm.x) * w,
            y: lm.y * h,
          };
          const fp = pixelToFret(h13, px);

          const onFretboard = fp.fret >= -0.5 && fp.fret <= 12.5 && fp.string >= -0.5 && fp.string <= 3.5;

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

          // Label with fret/string if on the neck
          if (onFretboard) {
            const sIdx = Math.round(Math.max(0, Math.min(3, fp.string)));
            const fIdx = Math.round(Math.max(0, Math.min(12, fp.fret)));
            const stringName = ["E", "A", "D", "G"][sIdx];
            ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
            ctx.fillRect(px.x + 14, px.y - 8, 46, 16);
            ctx.fillStyle = FINGERTIP_COLORS[name];
            ctx.font = "bold 10px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${stringName}${fIdx}`, px.x + 18, px.y);
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

  // Click handler for calibration taps
  const handlePointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isComplete) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      addPoint({ x, y });
    },
    [isComplete, addPoint]
  );

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      {/* Webcam container — relative so canvas can overlay */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerDown={handlePointer}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 p-3 sm:p-4 flex items-start justify-between pointer-events-none">
        <div className="pointer-events-auto">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">bass.lab</h1>
          <p className="text-zinc-400 text-xs">
            {!webcamReady
              ? "Starting webcam..."
              : handsLoading
                ? "Loading hand tracking..."
                : isComplete
                  ? "Calibrated — move your fretting hand into view"
                  : "Calibrate your fretboard"}
          </p>
        </div>
        <a
          href="/"
          className="pointer-events-auto text-xs text-zinc-400 hover:text-white active:scale-95 transition px-3 py-1.5 rounded-full bg-white/10 border border-white/10"
        >
          ← back
        </a>
      </div>

      {/* Calibration prompt (centered top) */}
      {!isComplete && webcamReady && !handsLoading && (
        <div className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/75 backdrop-blur-md border border-white/15 rounded-xl px-4 py-2.5 text-center">
            <div className="text-xs text-zinc-400 mb-1">Step {step + 1} of 4</div>
            <div className="text-sm font-medium">
              {currentLabel}
            </div>
            <div
              className="w-3 h-3 mx-auto mt-2 rounded-full"
              style={{ backgroundColor: CALIB_COLORS[step] }}
            />
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 flex items-center justify-center gap-2 pointer-events-none">
        <div className="pointer-events-auto flex gap-2">
          {points.length > 0 && !isComplete && (
            <button
              onClick={undo}
              className="px-3 py-2 text-xs rounded-full bg-white/10 hover:bg-white/20 border border-white/10 active:scale-95 transition"
            >
              ← undo
            </button>
          )}
          {points.length > 0 && (
            <button
              onClick={reset}
              className="px-3 py-2 text-xs rounded-full bg-white/10 hover:bg-white/20 border border-white/10 active:scale-95 transition"
            >
              {isComplete ? "recalibrate" : "reset"}
            </button>
          )}
        </div>
      </div>

      {/* First-time hint */}
      {points.length === 0 && webcamReady && !handsLoading && (
        <div className="absolute bottom-14 sm:bottom-16 left-1/2 -translate-x-1/2 text-center pointer-events-none px-4">
          <p className="text-zinc-400 text-xs max-w-xs">
            Hold your bass in playing position. Tap the 4 corners of the fretboard when prompted.
          </p>
        </div>
      )}
    </div>
  );
}
