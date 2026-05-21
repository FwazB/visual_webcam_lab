"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import CameraDistortion, { type DistortionMode } from "./CameraDistortion";
import { useAudioReactiveInput } from "@/hooks/useAudioReactiveInput";
import { useBodySegmentation } from "@/hooks/useBodySegmentation";

const DISTORTION_MODES: DistortionMode[] = [
  "clean",
  "overdrive",
  "fuzz",
  "glitch",
  "strobe",
];

export default function Visualz() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [mode, setMode] = useState<DistortionMode>("overdrive");
  const [meterLevel, setMeterLevel] = useState(0);
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
    if (!isListening) {
      return;
    }

    let rafId = 0;
    const tick = () => {
      setMeterLevel(levelRef.current);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isListening, levelRef]);

  const displayedMeterLevel = isListening ? meterLevel : 0;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover -scale-x-100 opacity-80 pointer-events-none"
      />

      <CameraDistortion
        videoRef={videoRef}
        levelRef={levelRef}
        peakRef={peakRef}
        maskRef={maskRef}
        maskSizeRef={maskSizeRef}
        enabled={isListening}
        mode={mode}
      />

      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">visualz</h1>
          <p className="text-xs text-zinc-400">
            {!webcamReady
              ? "Starting camera..."
              : bodyMaskLoading
                ? "Loading body mask..."
              : isListening
                ? "Body-reactive distortion active"
                : "Start audio input and strum"}
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
              {isListening ? "Stop audio" : "Start audio"}
            </button>
            <span className="rounded bg-white/10 px-2.5 py-2 text-[10px] font-mono uppercase text-zinc-300">
              body mask
            </span>

            <div className="flex flex-wrap gap-1">
              {DISTORTION_MODES.map((distortionMode) => (
                <button
                  key={distortionMode}
                  onClick={() => setMode(distortionMode)}
                  className={`rounded px-2.5 py-2 text-[10px] font-mono uppercase transition active:scale-95 ${
                    mode === distortionMode
                      ? "bg-white text-black"
                      : "bg-white/10 text-zinc-300 hover:bg-white/20"
                  }`}
                >
                  {distortionMode}
                </button>
              ))}
            </div>
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
