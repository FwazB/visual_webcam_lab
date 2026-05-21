"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BodyPulseOverlay from "./BodyPulseOverlay";
import CameraDistortion, { type DistortionMode } from "./CameraDistortion";
import { useAudioReactiveInput } from "@/hooks/useAudioReactiveInput";
import { useBodySegmentation } from "@/hooks/useBodySegmentation";

const PROJECTION_MODES: DistortionMode[] = [
  "aura",
  "echo",
  "rift",
  "shatter",
  "pulse",
];

const MODE_LABELS: Record<DistortionMode, string> = {
  aura: "Aura",
  echo: "Echo",
  rift: "Rift",
  shatter: "Shatter",
  pulse: "Pulse",
};

export default function Visualz() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [mode, setMode] = useState<DistortionMode>("aura");
  const [intensity, setIntensity] = useState(1);
  const [baseColor, setBaseColor] = useState("#ff7a18");
  const [meterLevel, setMeterLevel] = useState(0);
  const [maskReady, setMaskReady] = useState(false);
  const {
    isLoading: bodyMaskLoading,
    maskRef,
    maskSizeRef,
    startSegmentation,
  } = useBodySegmentation(videoRef);
  const {
    isListening,
    error,
    levelRef,
    peakRef,
    toneRef,
    start,
    stop,
  } = useAudioReactiveInput();

  useEffect(() => {
    let stream: MediaStream | null = null;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

    async function startCamera() {
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

    startCamera();
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (webcamReady && !bodyMaskLoading) {
      startSegmentation();
    }
  }, [bodyMaskLoading, startSegmentation, webcamReady]);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setMeterLevel(isListening ? levelRef.current : 0);
      setMaskReady(Boolean(maskRef.current));
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isListening, levelRef, maskRef]);

  const displayedMeterLevel = isListening ? meterLevel : 0;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 z-0 h-full w-full object-cover -scale-x-100 opacity-80 pointer-events-none"
      />

      <CameraDistortion
        videoRef={videoRef}
        levelRef={levelRef}
        peakRef={peakRef}
        toneRef={toneRef}
        maskRef={maskRef}
        maskSizeRef={maskSizeRef}
        enabled={isListening}
        mode={mode}
        intensity={intensity}
        baseColor={baseColor}
      />

      <BodyPulseOverlay
        enabled={isListening}
        levelRef={levelRef}
        peakRef={peakRef}
        toneRef={toneRef}
        maskRef={maskRef}
        maskSizeRef={maskSizeRef}
        mode={mode}
        intensity={intensity}
        baseColor={baseColor}
      />

      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">visualz</h1>
          <p className="text-xs text-zinc-400">
            {!webcamReady
              ? "Starting camera..."
              : bodyMaskLoading
                ? "Loading body mask..."
                : !maskReady
                  ? "Finding body..."
              : isListening
                ? `${MODE_LABELS[mode]} projection active`
                : "Start audio control and play"}
          </p>
        </div>

        <Link
          href="/"
          className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-zinc-300 transition active:scale-95 hover:text-white"
        >
          back
        </Link>
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-col gap-2 sm:right-auto sm:max-w-2xl">
        <div className="rounded-lg border border-white/10 bg-black/65 p-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={isListening ? stop : start}
              className={`rounded px-3 py-2 text-[11px] font-mono font-semibold uppercase tracking-wide transition active:scale-95 ${
                isListening
                  ? "bg-red-500/20 text-red-200 hover:bg-red-500/30"
                  : "bg-yellow-400 text-black hover:bg-yellow-300"
              }`}
            >
              {isListening ? "Stop control" : "Start control"}
            </button>
            <span className="rounded bg-white/10 px-2.5 py-2 text-[10px] font-mono uppercase text-zinc-300">
              {maskReady ? "room map" : "body scan"}
            </span>

            <div className="flex flex-wrap gap-1">
              {PROJECTION_MODES.map((projectionMode) => (
                <button
                  key={projectionMode}
                  onClick={() => setMode(projectionMode)}
                  className={`rounded px-2.5 py-2 text-[10px] font-mono uppercase transition active:scale-95 ${
                    mode === projectionMode
                      ? "bg-white text-black"
                      : "bg-white/10 text-zinc-300 hover:bg-white/20"
                  }`}
                >
                  {MODE_LABELS[projectionMode]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-[10px] font-mono uppercase text-zinc-400">
                <span>Intensity</span>
                <span className="tabular-nums text-zinc-300">
                  {Math.round(intensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={intensity}
                onChange={(event) => setIntensity(Number(event.target.value))}
                className="w-full accent-white/80"
              />
            </label>

            <label className="flex items-center gap-2 text-[10px] font-mono uppercase text-zinc-400">
              <span>Color</span>
              <input
                type="color"
                value={baseColor}
                onChange={(event) => setBaseColor(event.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
                aria-label="Projection color"
              />
            </label>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-yellow-400 transition-[width]"
              style={{
                width: `${Math.min(100, Math.round(displayedMeterLevel * 100))}%`,
              }}
            />
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-400/30 bg-red-950/70 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
