"use client";

import { type MutableRefObject, useEffect, useRef } from "react";

type BodyPulseOverlayProps = {
  enabled: boolean;
  levelRef: MutableRefObject<number>;
  peakRef: MutableRefObject<number>;
  maskRef: MutableRefObject<Float32Array | null>;
  maskSizeRef: MutableRefObject<{ width: number; height: number }>;
};

const MAX_DPR = 1.5;

export default function BodyPulseOverlay({
  enabled,
  levelRef,
  peakRef,
  maskRef,
  maskSizeRef,
}: BodyPulseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    let rafId = 0;
    let imageData: ImageData | null = null;
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
        const drive = Math.min(1, Math.max(0, level * 2.8 + peak * 1.6));
        const idleAlpha = 36;
        const activeAlpha = 190;
        const edgeBoost = enabledRef.current ? 70 + drive * 150 : 40;

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

            imageData.data[idx] = 255;
            imageData.data[idx + 1] = Math.round(122 + drive * 120);
            imageData.data[idx + 2] = Math.round(20 + edge * 120);
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

          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.filter = `blur(${Math.max(0, drive * 8)}px)`;
          ctx.drawImage(maskCanvas, dx, dy, drawWidth, drawHeight);
          ctx.filter = "none";
          ctx.drawImage(maskCanvas, dx, dy, drawWidth, drawHeight);
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [levelRef, maskRef, maskSizeRef, peakRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 z-[2] h-full w-full -scale-x-100 pointer-events-none mix-blend-screen"
    />
  );
}
