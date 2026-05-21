"use client";

import { type MutableRefObject, useEffect, useRef } from "react";
import type { DistortionMode } from "./CameraDistortion";
import type { ToneProfile } from "@/hooks/useAudioReactiveInput";
import type { TrackedObject } from "@/hooks/useMaskObjectTracking";
import type { PoseData } from "@/hooks/usePoseTracking";

export type BackgroundEffect = "off" | "orbits" | "grid" | "bursts";

type BodyPulseOverlayProps = {
  enabled: boolean;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  toneRef: MutableRefObject<ToneProfile>;
  poseDataRef: MutableRefObject<PoseData | null>;
  trackingRef: MutableRefObject<TrackedObject>;
  maskRef: MutableRefObject<Float32Array | null>;
  maskSizeRef: MutableRefObject<{ width: number; height: number }>;
  modes: DistortionMode[];
  intensity: number;
  baseColor: string;
  backgroundEffect: BackgroundEffect;
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

type HandEmitter = {
  x: number;
  y: number;
  activity: number;
};

const HAND_LANDMARKS = {
  thumbTip: 4,
  indexTip: 8,
  middleTip: 12,
  wrist: 0,
} as const;

export default function BodyPulseOverlay({
  enabled,
  levelRef,
  peakRef,
  toneRef,
  poseDataRef,
  trackingRef,
  maskRef,
  maskSizeRef,
  modes,
  intensity,
  baseColor,
  backgroundEffect,
}: BodyPulseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabledRef = useRef(enabled);
  const modesRef = useRef(modes);
  const intensityRef = useRef(intensity);
  const baseColorRef = useRef(baseColor);
  const backgroundEffectRef = useRef(backgroundEffect);

  useEffect(() => {
    enabledRef.current = enabled;
    modesRef.current = modes;
    intensityRef.current = intensity;
    baseColorRef.current = baseColor;
    backgroundEffectRef.current = backgroundEffect;
  }, [backgroundEffect, baseColor, enabled, intensity, modes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let rafId = 0;
    let frameCount = 0;
    let imageData: ImageData | null = null;
    let previousCentroid: { x: number; y: number } | null = null;
    let previousSignal = 0;
    let beatCooldown = 0;
    let beatIndex = 0;
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
        const signal = level * 0.65 + peak * 0.35;
        const tone = enabledRef.current
          ? toneRef.current
          : { low: 0, mid: 0, high: 0, depth: 0 };
        const modes = modesRef.current;
        const hasMode = (mode: DistortionMode) => modes.includes(mode);
        const intensity = Math.max(0, Math.min(2.5, intensityRef.current));
        const drive = Math.min(1, Math.max(0, (level * 2.8 + peak * 1.6) * intensity));
        const trailBoost =
          (hasMode("echo") ? 1.25 : 0.7) +
          (hasMode("rift") ? 0.35 : 0) +
          (hasMode("pulse") ? 0.2 : 0);
        const edgeModeBoost =
          1 + (hasMode("shatter") ? 0.5 : 0) + (hasMode("pulse") ? 0.25 : 0);
        const idleAlpha = 36;
        const activeAlpha = 190;
        const edgeBoost = (enabledRef.current ? 70 + drive * 150 : 40) * edgeModeBoost;
        const [baseRed, baseGreen, baseBlue] = hexToRgb(baseColorRef.current);
        const red = Math.round(baseRed * 210 + tone.depth * 45 + tone.mid * 16);
        const green = Math.round(baseGreen * 210 + tone.mid * 42 + tone.high * 28);
        const blue = Math.round(baseBlue * 210 + tone.high * 54 + (1 - tone.depth) * 10);
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
          const tracked = trackingRef.current;
          const handEmitters = getHandEmitters(poseDataRef.current, canvas.width, canvas.height);
          const trackedCenterX = tracked.cx * canvas.width;
          const trackedCenterY = tracked.cy * canvas.height;
          const trackingWeight = Math.min(1, tracked.presence * 1.25);
          const centerX = centroid
            ? trackedCenterX * trackingWeight + (dx + centroid.x * scale) * (1 - trackingWeight)
            : trackedCenterX;
          const centerY = centroid
            ? trackedCenterY * trackingWeight + (dy + centroid.y * scale) * (1 - trackingWeight)
            : trackedCenterY;

          if (centroid) previousCentroid = centroid;
          if (
            enabledRef.current &&
            signal > 0.18 &&
            previousSignal <= 0.16 &&
            beatCooldown <= 0
          ) {
            beatIndex++;
            beatCooldown = 12;
          }
          beatCooldown = Math.max(0, beatCooldown - 1);
          previousSignal = signal * 0.7 + previousSignal * 0.3;

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
          drawBackgroundSequence({
            ctx,
            effect: backgroundEffectRef.current,
            centerX,
            centerY,
            width: canvas.width,
            height: canvas.height,
            beatIndex,
            frameCount,
            drive,
            tone,
            color: [baseRed, baseGreen, baseBlue],
            intensity,
            objectScale: 0.75 + tracked.area * 2.4,
            velocity: Math.hypot(tracked.vx, tracked.vy),
            handEmitters,
          });

          trailFrames.forEach((trail, i) => {
            const age = i + 1;
            const fade = 1 - i / TRAIL_LENGTH;
            const modes = modesRef.current;
            const hasMode = (mode: DistortionMode) => modes.includes(mode);
            const modeDrift =
              1 + (hasMode("echo") ? 0.9 : 0) + (hasMode("rift") ? 0.35 : 0);
            const lagX = -trail.vx * scale * age * 3.8 * modeDrift;
            const lagY =
              -trail.vy * scale * age * 3.8 * modeDrift -
              age * (0.8 + trail.drive * 2.8) * (hasMode("pulse") ? 0.7 : 1);
            const sway =
              Math.sin((frameCount - i * 4) * (0.045 + trail.tone.high * 0.12)) *
              age *
              trail.drive *
              (1.0 + trail.tone.mid) *
              (hasMode("rift") ? 2.2 : 1);

            ctx.globalAlpha = fade * fade * (0.16 + trail.drive * 0.34) * trailBoost;
            ctx.filter =
              hasMode("shatter")
                ? `blur(${1.2 + age * 0.5}px) contrast(${1.4 + trail.tone.high})`
                : `blur(${3 + age * 1.2 + trail.drive * 8 * Math.max(0.5, intensity)}px)`;
            ctx.drawImage(
              trail.canvas,
              dx + lagX + sway,
              dy + lagY,
              drawWidth,
              drawHeight,
            );
          });
          ctx.globalAlpha = 1;
          ctx.filter = `blur(${Math.max(0, drive * 8 * Math.max(0.5, intensity))}px)`;
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
  }, [levelRef, maskRef, maskSizeRef, peakRef, poseDataRef, toneRef, trackingRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-[2] h-full w-full -scale-x-100 pointer-events-none mix-blend-screen"
    />
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : "ff7a18";
  const value = Number.parseInt(normalized, 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

function drawBackgroundSequence({
  ctx,
  effect,
  centerX,
  centerY,
  width,
  height,
  beatIndex,
  frameCount,
  drive,
  tone,
  color,
  intensity,
  objectScale,
  velocity,
  handEmitters,
}: {
  ctx: CanvasRenderingContext2D;
  effect: BackgroundEffect;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  beatIndex: number;
  frameCount: number;
  drive: number;
  tone: ToneProfile;
  color: [number, number, number];
  intensity: number;
  objectScale: number;
  velocity: number;
  handEmitters: HandEmitter[];
}) {
  if (effect === "off" || intensity <= 0.01) return;

  const alpha = Math.min(
    0.85,
    (0.08 + drive * 0.55 + velocity * 5.5) * Math.max(0.15, intensity),
  );
  const red = Math.round(Math.min(255, color[0] * 225 + tone.depth * 30));
  const green = Math.round(Math.min(255, color[1] * 225 + tone.mid * 55));
  const blue = Math.round(Math.min(255, color[2] * 225 + tone.high * 70));
  const stroke = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  const fill = `rgba(${red}, ${green}, ${blue}, ${alpha * 0.28})`;
  const phase = beatIndex % 8;
  const emitters =
    handEmitters.length > 0
      ? handEmitters
      : [{ x: centerX, y: centerY, activity: Math.max(0.35, drive) }];

  ctx.save();
  ctx.lineWidth = Math.max(1, 1 + drive * 3);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;

  if (effect === "orbits") {
    const count = 6;
    const radius = (72 + phase * 18 + drive * 140) * objectScale;
    emitters.forEach((emitter, emitterIndex) => {
      const emitterRadius = radius * (0.55 + emitter.activity * 0.65);
      for (let i = 0; i < count; i++) {
        const angle =
          (Math.PI * 2 * i) / count +
          beatIndex * 0.55 +
          frameCount * 0.012 +
          emitterIndex * 0.8;
        const x = emitter.x + Math.cos(angle) * emitterRadius * (1.1 + tone.high * 0.5);
        const y = emitter.y + Math.sin(angle) * emitterRadius * (0.72 + tone.depth * 0.45);
        const size = 8 + ((phase + i) % 4) * 6 + drive * 30 * emitter.activity;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.stroke();
        if ((phase + i + emitterIndex) % 2 === 0) ctx.fill();
      }
    });
  } else if (effect === "grid") {
    const spacing = Math.max(24, (42 + phase * 4) / Math.max(0.75, objectScale * 0.72));
    const offset = (frameCount * (0.6 + drive * 2.4) + beatIndex * spacing * 0.25) % spacing;
    for (let x = -spacing; x < width + spacing; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + offset, 0);
      ctx.lineTo(x - offset * 0.35, height);
      ctx.stroke();
    }
    for (let y = -spacing; y < height + spacing; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + offset);
      ctx.lineTo(width, y - offset * 0.35);
      ctx.stroke();
    }
  } else {
    const rays = 10;
    emitters.forEach((emitter, emitterIndex) => {
      for (let i = 0; i < rays; i++) {
        const step = (phase + i + emitterIndex * 2) % rays;
        const angle = (Math.PI * 2 * step) / rays + frameCount * 0.006;
        const inner = 24 + drive * 38 * emitter.activity;
        const outer =
          Math.max(width, height) *
          (0.22 + objectScale * 0.1 + ((i + phase) % 5) * 0.07 + emitter.activity * 0.16);
        ctx.beginPath();
        ctx.moveTo(emitter.x + Math.cos(angle) * inner, emitter.y + Math.sin(angle) * inner);
        ctx.lineTo(emitter.x + Math.cos(angle) * outer, emitter.y + Math.sin(angle) * outer);
        ctx.stroke();
      }
    });
  }

  ctx.restore();
}

function getHandEmitters(
  pose: PoseData | null,
  canvasWidth: number,
  canvasHeight: number,
): HandEmitter[] {
  if (!pose?.handsVisible || pose.landmarks.length === 0) return [];

  const wrist = pose.landmarks[HAND_LANDMARKS.wrist];
  const index = pose.landmarks[HAND_LANDMARKS.indexTip];
  const middle = pose.landmarks[HAND_LANDMARKS.middleTip];
  const thumb = pose.landmarks[HAND_LANDMARKS.thumbTip];
  if (!wrist || !index) return [];

  const fingertips = [index, middle, thumb].filter(Boolean);
  const x =
    fingertips.reduce((sum, landmark) => sum + (1 - landmark.x) * canvasWidth, 0) /
    fingertips.length;
  const y =
    fingertips.reduce((sum, landmark) => sum + landmark.y * canvasHeight, 0) /
    fingertips.length;
  const spread = middle
    ? Math.hypot(index.x - middle.x, index.y - middle.y)
    : Math.hypot(index.x - wrist.x, index.y - wrist.y);

  return [
    {
      x,
      y,
      activity: Math.max(0.35, Math.min(1, spread * 9 + (1 - pose.leftPinch) * 0.25)),
    },
  ];
}
