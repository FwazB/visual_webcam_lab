"use client";

import { type MutableRefObject, useEffect, useRef } from "react";
import type { DistortionMode } from "./CameraDistortion";
import type { ToneProfile } from "@/hooks/useAudioReactiveInput";

type BodyPulseOverlayProps = {
  enabled: boolean;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  toneRef: MutableRefObject<ToneProfile>;
  maskRef: MutableRefObject<Float32Array | null>;
  maskSizeRef: MutableRefObject<{ width: number; height: number }>;
  mode: DistortionMode;
};

const MAX_DPR = 1.5;
const TRAIL_LENGTH = 9;
const TRAIL_SAMPLE_RATE = 3;

type TrailFrame = {
  canvas: HTMLCanvasElement;
  vx: number;
  vy: number;
  drive: number;
  tone: ToneProfile;
};

export default function BodyPulseOverlay({
  enabled,
  levelRef,
  peakRef,
  toneRef,
  maskRef,
  maskSizeRef,
  mode,
}: BodyPulseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabledRef = useRef(enabled);
  const modeRef = useRef(mode);

  useEffect(() => {
    enabledRef.current = enabled;
    modeRef.current = mode;
  }, [enabled, mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let rafId = 0;
    let frameCount = 0;
    let imageData: ImageData | null = null;
    let previousCentroid: { x: number; y: number } | null = null;
    const trailFrames: TrailFrame[] = [];
    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const draw = () => {
      resize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const mask = maskRef.current;
      const { width, height } = maskSizeRef.current;

      if (mask && width > 0 && height > 0 && mask.length >= width * height) {
        if (!imageData || imageData.width !== width || imageData.height !== height) {
          imageData = ctx.createImageData(width, height);
        }

        const level = enabledRef.current ? levelRef.current : 0;
        const peak = enabledRef.current ? peakRef.current : 0;
        const tone = enabledRef.current
          ? toneRef.current
          : { low: 0, mid: 0, high: 0, depth: 0 };
        const mode = modeRef.current;
        const drive = Math.min(1, Math.max(0, level * 2.8 + peak * 1.6));
        const trailBoost =
          mode === "echo" ? 1.9 : mode === "rift" ? 1.35 : mode === "pulse" ? 1.1 : 0.85;
        const edgeModeBoost = mode === "shatter" ? 1.5 : mode === "pulse" ? 1.25 : 1;
        const idleAlpha = 36;
        const activeAlpha = 190;
        const edgeBoost = (enabledRef.current ? 70 + drive * 150 : 40) * edgeModeBoost;
        const red = Math.round(190 + tone.depth * 65);
        const green = Math.round(92 + tone.mid * 190 + tone.high * 70);
        const blue = Math.round(18 + tone.high * 220 + (1 - tone.depth) * 35);
        let bodyWeight = 0;
        let centroidX = 0;
        let centroidY = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const value = mask[i];
            const left = x > 0 ? mask[i - 1] : value;
            const right = x < width - 1 ? mask[i + 1] : value;
            const up = y > 0 ? mask[i - width] : value;
            const down = y < height - 1 ? mask[i + width] : value;
            const edge = Math.min(1, Math.abs(right - left) + Math.abs(down - up));
            const body = Math.max(0, Math.min(1, (value - 0.38) / 0.38));
            const alpha = Math.min(255, body * (idleAlpha + drive * activeAlpha) + edge * edgeBoost);
            const idx = i * 4;

            if (body > 0.2) {
              bodyWeight += body;
              centroidX += x * body;
              centroidY += y * body;
            }

            imageData.data[idx] = red;
            imageData.data[idx + 1] = Math.min(255, Math.round(green + drive * 60));
            imageData.data[idx + 2] = Math.min(255, Math.round(blue + edge * 120));
            imageData.data[idx + 3] = Math.round(alpha);
          }
        }

        if (maskCtx) {
          if (maskCanvas.width !== width || maskCanvas.height !== height) {
            maskCanvas.width = width;
            maskCanvas.height = height;
          }
          maskCtx.putImageData(imageData, 0, 0);
          const scale = Math.max(canvas.width / width, canvas.height / height);
          const drawWidth = width * scale;
          const drawHeight = height * scale;
          const dx = (canvas.width - drawWidth) / 2;
          const dy = (canvas.height - drawHeight) / 2;
          const centroid =
            bodyWeight > 0
              ? { x: centroidX / bodyWeight, y: centroidY / bodyWeight }
              : previousCentroid;
          const velocity =
            centroid && previousCentroid
              ? {
                  x: centroid.x - previousCentroid.x,
                  y: centroid.y - previousCentroid.y,
                }
              : { x: 0, y: 0 };

          if (centroid) previousCentroid = centroid;

          if (frameCount % TRAIL_SAMPLE_RATE === 0) {
            const snapshot = document.createElement("canvas");
            snapshot.width = width;
            snapshot.height = height;
            snapshot.getContext("2d")?.drawImage(maskCanvas, 0, 0);
            trailFrames.unshift({
              canvas: snapshot,
              vx: velocity.x,
              vy: velocity.y,
              drive,
              tone,
            });
            if (trailFrames.length > TRAIL_LENGTH) trailFrames.pop();
          }

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          trailFrames.forEach((trail, i) => {
            const age = i + 1;
            const fade = 1 - i / TRAIL_LENGTH;
            const mode = modeRef.current;
            const modeDrift = mode === "echo" ? 1.9 : mode === "rift" ? 1.35 : 1;
            const lagX = -trail.vx * scale * age * 3.8 * modeDrift;
            const lagY =
              -trail.vy * scale * age * 3.8 * modeDrift -
              age * (0.8 + trail.drive * 2.8) * (mode === "pulse" ? 0.7 : 1);
            const sway =
              Math.sin((frameCount - i * 4) * (0.045 + trail.tone.high * 0.12)) *
              age *
              trail.drive *
              (1.0 + trail.tone.mid) *
              (mode === "rift" ? 2.2 : 1);

            ctx.globalAlpha = fade * fade * (0.16 + trail.drive * 0.34) * trailBoost;
            ctx.filter =
              mode === "shatter"
                ? `blur(${1.2 + age * 0.5}px) contrast(${1.4 + trail.tone.high})`
                : `blur(${3 + age * 1.2 + trail.drive * 8}px)`;
            ctx.drawImage(
              trail.canvas,
              dx + lagX + sway,
              dy + lagY,
              drawWidth,
              drawHeight,
            );
          });
          ctx.globalAlpha = 1;
          ctx.filter = `blur(${Math.max(0, drive * 8)}px)`;
          ctx.drawImage(maskCanvas, dx, dy, drawWidth, drawHeight);
          ctx.filter = "none";
          ctx.drawImage(maskCanvas, dx, dy, drawWidth, drawHeight);
          ctx.restore();
        }
      }

      frameCount++;
      rafId = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [levelRef, maskRef, maskSizeRef, peakRef, toneRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-[2] h-full w-full -scale-x-100 pointer-events-none mix-blend-screen"
    />
  );
}
