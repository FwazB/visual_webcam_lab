"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useBodySegmentation } from "@/hooks/useBodySegmentation";

// ASCII chars from dark to light
const ASCII_RAMP = " .,:;+*?%S#@";
const CELL_W = 8;
const CELL_H = 14;
const MASK_THRESHOLD = 0.5;

export default function AsciiCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [colorMode, setColorMode] = useState(true);
  const rafRef = useRef<number>(0);

  const { isLoading, maskRef, maskSizeRef, startSegmentation } =
    useBodySegmentation(videoRef);

  // Start webcam
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function initCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => setWebcamReady(true);
        }
      } catch (err) {
        console.error("Camera access denied:", err);
      }
    }

    initCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Start segmentation once webcam is ready and model is loaded
  useEffect(() => {
    if (webcamReady && !isLoading) {
      startSegmentation();
    }
  }, [webcamReady, isLoading, startSegmentation]);

  // ASCII render loop
  const renderAscii = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const sampleCanvas = sampleCanvasRef.current;
    if (!video || !canvas || !sampleCanvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderAscii);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Calculate grid dimensions from display size
    const displayW = canvas.width;
    const displayH = canvas.height;
    const cols = Math.floor(displayW / CELL_W);
    const rows = Math.floor(displayH / CELL_H);

    // Sample video at grid resolution
    const sCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sCtx) return;
    sampleCanvas.width = cols;
    sampleCanvas.height = rows;

    // Mirror horizontally to match selfie view
    sCtx.save();
    sCtx.scale(-1, 1);
    sCtx.drawImage(video, -cols, 0, cols, rows);
    sCtx.restore();

    const imageData = sCtx.getImageData(0, 0, cols, rows);
    const pixels = imageData.data;

    const mask = maskRef.current;
    const maskW = maskSizeRef.current.width;
    const maskH = maskSizeRef.current.height;

    // Clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, displayW, displayH);

    ctx.font = `${CELL_H}px monospace`;
    ctx.textBaseline = "top";

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Check segmentation mask — is this pixel part of the person?
        if (mask && maskW > 0 && maskH > 0) {
          // Map grid position to mask position (mask is not mirrored, so flip x)
          const maskX = Math.floor(((cols - 1 - col) / cols) * maskW);
          const maskY = Math.floor((row / rows) * maskH);
          const maskIdx = maskY * maskW + maskX;
          if (mask[maskIdx] < MASK_THRESHOLD) continue;
        }

        const pIdx = (row * cols + col) * 4;
        const r = pixels[pIdx];
        const g = pixels[pIdx + 1];
        const b = pixels[pIdx + 2];

        // Perceived brightness (luminance)
        const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const charIdx = Math.floor(brightness * (ASCII_RAMP.length - 1));
        const char = ASCII_RAMP[charIdx];

        if (char === " ") continue;

        if (colorMode) {
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = "#0f0";
        }

        ctx.fillText(char, col * CELL_W, row * CELL_H);
      }
    }

    rafRef.current = requestAnimationFrame(renderAscii);
  }, [maskRef, maskSizeRef, colorMode]);

  // Start/stop render loop
  useEffect(() => {
    if (webcamReady) {
      rafRef.current = requestAnimationFrame(renderAscii);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [webcamReady, renderAscii]);

  // Resize canvas to fill window
  useEffect(() => {
    function resize() {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Hidden video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute opacity-0 pointer-events-none"
      />

      {/* Hidden sampling canvas */}
      <canvas ref={sampleCanvasRef} className="hidden" />

      {/* ASCII output canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Status overlay */}
      <div className="absolute top-4 left-4 text-white/60 text-sm font-mono select-none">
        {!webcamReady
          ? "Starting webcam..."
          : isLoading
            ? "Loading segmentation model..."
            : ""}
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <button
          onClick={() => setColorMode((c) => !c)}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm font-mono rounded transition-colors"
        >
          {colorMode ? "color" : "mono"}
        </button>
      </div>
    </div>
  );
}
