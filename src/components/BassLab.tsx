"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import {
  inferFretboard,
  smoothFretboard,
  pixelToFret,
  type HandFretboard,
} from "@/lib/bass/handFretboard";
import {
  SHAPES,
  KEYS,
  resolveShape,
  matchShape,
  type MatchState,
} from "@/lib/bass/shapes";
import { NOTE_NAMES, noteAt } from "@/lib/bass/theory";

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
const STRING_LABELS = ["E", "A", "D", "G"];

const TRAFFIC_COLORS: Record<MatchState, string> = {
  green: "#22dd55",
  yellow: "#ffcc00",
  red: "#ff4455",
};

type FingerPos = { string: number; fret: number };

export default function BassLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const fretboardCanvasRef = useRef<HTMLCanvasElement>(null);
  const fretboardContainerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [handPosition, setHandPosition] = useState(0);
  const [shapeId, setShapeId] = useState(SHAPES[0].id);
  const [keyName, setKeyName] = useState<(typeof KEYS)[number]>("A");
  const [matchState, setMatchState] = useState<MatchState>("red");

  const { poseDataRef, isLoading: handsLoading } = usePoseTracking(videoRef);
  const fbRef = useRef<HandFretboard | null>(null);
  const fingerPositionsRef = useRef<Partial<Record<FingerName, FingerPos>>>({});
  const handPositionRef = useRef(handPosition);
  handPositionRef.current = handPosition;

  const shape = useMemo(
    () => SHAPES.find((s) => s.id === shapeId) ?? SHAPES[0],
    [shapeId]
  );
  const rootPc = NOTE_NAMES.indexOf(keyName);
  const targets = useMemo(() => resolveShape(shape, rootPc), [shape, rootPc]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

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

  // Render loop
  useEffect(() => {
    let rafId = 0;
    let lastMatch: MatchState = "red";
    let matchFrameCounter = 0;

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
      const positions: Partial<Record<FingerName, FingerPos>> = {};

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

      if (pose && pose.landmarks.length >= 21) {
        (Object.keys(FINGERTIPS) as FingerName[]).forEach((name) => {
          const idx = FINGERTIPS[name];
          const lm = pose.landmarks[idx];
          if (!lm) return;
          const px = { x: (1 - lm.x) * w, y: lm.y * h };

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
      const stringH = boardH / 3;

      // Fretboard body
      ctx.fillStyle = "#1c1410";
      ctx.fillRect(padL, padT, boardW, boardH);

      // Inlay dots
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      for (const f of [3, 5, 7, 9]) {
        if (f > FRET_COUNT) continue;
        ctx.beginPath();
        ctx.arc(padL + (f - 0.5) * fretW, padT + boardH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
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
        ctx.lineWidth = 2 - s * 0.35;
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

      // Fret numbers
      ctx.fillStyle = "rgba(170, 170, 170, 0.7)";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let f = 1; f <= FRET_COUNT; f++) {
        ctx.fillText(f.toString(), padL + (f - 0.5) * fretW, padT + boardH + 4);
      }

      // Compute absolute finger positions (for matching + drawing)
      const base = handPositionRef.current;
      const absFingers: Array<{ string: number; fret: number }> = [];
      const positions = fingerPositionsRef.current;
      (Object.keys(FINGERTIPS) as FingerName[]).forEach((name) => {
        const fp = positions[name];
        if (!fp) return;
        absFingers.push({
          string: Math.max(0, Math.min(3, fp.string)),
          fret: base + fp.fret,
        });
      });

      // Shape match
      const curTargets = targetsRef.current;
      const { state, coveredIdx } = matchShape(curTargets, absFingers);
      if (state !== lastMatch) {
        matchFrameCounter++;
        if (matchFrameCounter >= 3) {
          lastMatch = state;
          matchFrameCounter = 0;
          setMatchState(state);
        }
      } else {
        matchFrameCounter = 0;
      }

      // Target positions — draw as glowing rings with role labels
      curTargets.forEach((tgt, i) => {
        if (tgt.fret < 0 || tgt.fret > FRET_COUNT) return;
        const x = padL + tgt.fret * fretW;
        const y = padT + tgt.string * stringH;
        const isCovered = coveredIdx.has(i);
        const color = isCovered ? TRAFFIC_COLORS.green : TRAFFIC_COLORS.yellow;

        // Outer glow
        const glow = ctx.createRadialGradient(x, y, 4, x, y, 22);
        glow.addColorStop(0, color + "aa");
        glow.addColorStop(1, color + "00");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();

        // Ring
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();

        // Role label
        ctx.fillStyle = color;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tgt.role, x, y);

        // Note name above
        const note = noteAt(tgt.string, tgt.fret);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "9px monospace";
        ctx.fillText(note, x, y - 20);
      });

      // Finger dots on top
      (Object.keys(FINGERTIPS) as FingerName[]).forEach((name) => {
        const fp = positions[name];
        if (!fp) return;
        const sIdx = Math.round(Math.max(0, Math.min(3, fp.string)));
        const absFret = base + fp.fret;
        if (absFret < 0 || absFret > FRET_COUNT) return;

        const x = padL + absFret * fretW;
        const y = padT + sIdx * stringH;

        ctx.fillStyle = FINGERTIP_COLORS[name] + "40";
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = FINGERTIP_COLORS[name];
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
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
      : `${keyName} ${shape.name}`;

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden flex flex-col">
      {/* Top header */}
      <div className="relative z-10 p-3 sm:p-4 flex items-start justify-between flex-shrink-0 gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">bass.lab</h1>
          <p className="text-zinc-400 text-xs truncate">{status}</p>
        </div>

        {/* Traffic light */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
          {(["red", "yellow", "green"] as MatchState[]).map((s) => (
            <div
              key={s}
              className="w-3 h-3 rounded-full transition-all"
              style={{
                backgroundColor: matchState === s ? TRAFFIC_COLORS[s] : "#222",
                boxShadow:
                  matchState === s ? `0 0 12px ${TRAFFIC_COLORS[s]}` : "none",
              }}
            />
          ))}
        </div>

        <a
          href="/"
          className="text-xs text-zinc-400 hover:text-white active:scale-95 transition px-3 py-1.5 rounded-full bg-white/10 border border-white/10 flex-shrink-0"
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
        {/* Lesson blurb overlay */}
        <div className="absolute bottom-3 left-3 right-3 max-w-md bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Lesson
          </div>
          <div className="text-sm font-medium">
            {keyName} {shape.name}
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">{shape.description}</div>
        </div>
      </div>

      {/* Static fretboard panel */}
      <div className="bg-zinc-950/95 border-t border-white/10 flex-shrink-0">
        <div ref={fretboardContainerRef} className="relative h-36 sm:h-44">
          <canvas
            ref={fretboardCanvasRef}
            className="absolute inset-0 w-full h-full"
          />
        </div>

        {/* Hand position slider */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5">
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

        {/* Shape + key pickers */}
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SHAPES.map((s) => (
              <button
                key={s.id}
                onClick={() => setShapeId(s.id)}
                className={`text-[11px] font-mono px-2.5 py-1.5 rounded transition active:scale-95 ${
                  shapeId === s.id
                    ? "bg-white text-black"
                    : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setKeyName(k)}
                className={`text-[11px] font-mono w-8 h-7 rounded transition active:scale-95 ${
                  keyName === k
                    ? "bg-yellow-400 text-black"
                    : "bg-white/5 hover:bg-white/15 text-zinc-300"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
