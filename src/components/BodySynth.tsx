"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import ParamDisplay from "./ParamDisplay";

export default function BodySynth() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [trackName, setTrackName] = useState<string | null>(null);

  const { poseDataRef, isLoading: poseLoading, setOverlayCanvas } = usePoseTracking(videoRef);

  const {
    isPlaying,
    isLoaded: audioLoaded,
    locks,
    handTargets,
    audioParams,
    loadTrack,
    togglePlayback,
    updateFromPose,
    resetLocks,
  } = useAudioEngine();

  // Start webcam — lower resolution on mobile for performance
  useEffect(() => {
    async function startCamera() {
      try {
        const isMobile = window.innerWidth < 768;
        const stream = await navigator.mediaDevices.getUserMedia({
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
        console.error("Webcam error:", err);
      }
    }
    startCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Connect overlay canvas
  useEffect(() => {
    setOverlayCanvas(canvasRef.current);
  }, [setOverlayCanvas]);

  // Feed pose data to audio engine via RAF loop
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    let rafId: number;
    function tick() {
      if (isPlayingRef.current && poseDataRef.current) {
        updateFromPose(poseDataRef.current);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [poseDataRef, updateFromPose]);

  // Handle file drop / select
  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("audio/")) return;
      const url = URL.createObjectURL(file);
      setTrackName(file.name);
      await loadTrack(url);
    },
    [loadTrack]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      className="relative w-screen h-screen overflow-hidden bg-black"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Webcam feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover -scale-x-100"
      />

      {/* Hand tracking overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-cover -scale-x-100"
      />

      {/* Parameter display */}
      <ParamDisplay audioParams={audioParams} isPlaying={isPlaying} locks={locks} handTargets={handTargets} />

      {/* Controls overlay */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-3 sm:p-6 safe-top">
        <div className="min-w-0">
          <h1 className="text-white text-lg sm:text-2xl font-bold tracking-tight">body.synth</h1>
          <p className="text-zinc-400 text-xs sm:text-sm">
            {poseLoading
              ? "Loading hand tracking model..."
              : webcamReady
              ? "Hand tracking active"
              : "Starting webcam..."}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {trackName && (
            <span className="text-zinc-400 text-xs sm:text-sm font-mono truncate max-w-24 sm:max-w-48 hidden sm:inline">
              {trackName}
            </span>
          )}

          {!audioLoaded ? (
            <label className="cursor-pointer bg-white/10 hover:bg-white/20 active:bg-white/25 backdrop-blur-md text-white px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-medium transition-colors border border-white/10">
              Load MP3
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          ) : (
            <button
              onClick={togglePlayback}
              className={`px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-medium transition-colors border backdrop-blur-md active:scale-95 ${
                isPlaying
                  ? "bg-red-500/20 border-red-500/30 text-red-300 hover:bg-red-500/30 active:bg-red-500/40"
                  : "bg-green-500/20 border-green-500/30 text-green-300 hover:bg-green-500/30 active:bg-green-500/40"
              }`}
            >
              {isPlaying ? "Stop" : "Play"}
            </button>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-white text-base sm:text-xl font-semibold border-2 border-dashed border-white/30 rounded-2xl p-6 sm:p-12 mx-4">
            Drop your audio file here
          </div>
        </div>
      )}

      {/* Instructions (show when no audio loaded) */}
      {!audioLoaded && webcamReady && !poseLoading && (
        <div className="absolute bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 text-center px-4 safe-bottom">
          <p className="text-zinc-400 text-xs sm:text-sm">
            Drop an MP3 or tap &quot;Load MP3&quot; to get started
          </p>
        </div>
      )}
    </div>
  );
}
