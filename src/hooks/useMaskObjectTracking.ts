"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

export type TrackedObject = {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  presence: number;
};

const EMPTY_TRACK: TrackedObject = {
  cx: 0.5,
  cy: 0.5,
  vx: 0,
  vy: 0,
  minX: 0.35,
  minY: 0.2,
  maxX: 0.65,
  maxY: 0.85,
  area: 0,
  presence: 0,
};

type MaskSizeRef = MutableRefObject<{ width: number; height: number }>;

export function useMaskObjectTracking(
  maskRef: MutableRefObject<Float32Array | null>,
  maskSizeRef: MaskSizeRef,
) {
  const trackingRef = useRef<TrackedObject>({ ...EMPTY_TRACK });

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const mask = maskRef.current;
      const { width, height } = maskSizeRef.current;

      if (!mask || width <= 0 || height <= 0 || mask.length < width * height) {
        const current = trackingRef.current;
        trackingRef.current = {
          ...current,
          vx: current.vx * 0.82,
          vy: current.vy * 0.82,
          presence: current.presence * 0.86,
          area: current.area * 0.9,
        };
        rafId = requestAnimationFrame(tick);
        return;
      }

      let weight = 0;
      let cx = 0;
      let cy = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      const stride = width > 180 ? 2 : 1;

      for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
          const value = mask[y * width + x];
          const body = Math.max(0, Math.min(1, (value - 0.35) / 0.45));
          if (body <= 0.08) continue;

          weight += body;
          cx += x * body;
          cy += y * body;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      if (weight <= 0) {
        const current = trackingRef.current;
        trackingRef.current = {
          ...current,
          vx: current.vx * 0.82,
          vy: current.vy * 0.82,
          presence: current.presence * 0.9,
          area: current.area * 0.92,
        };
        rafId = requestAnimationFrame(tick);
        return;
      }

      const rawX = cx / weight / Math.max(1, width - 1);
      const rawY = cy / weight / Math.max(1, height - 1);
      const nextCx = 1 - rawX;
      const nextCy = rawY;
      const current = trackingRef.current;
      const smooth = current.presence > 0.05 ? 0.28 : 0.65;
      const smoothedCx = current.cx + (nextCx - current.cx) * smooth;
      const smoothedCy = current.cy + (nextCy - current.cy) * smooth;
      const nextMinX = 1 - maxX / Math.max(1, width - 1);
      const nextMaxX = 1 - minX / Math.max(1, width - 1);
      const nextMinY = minY / Math.max(1, height - 1);
      const nextMaxY = maxY / Math.max(1, height - 1);
      const area = Math.min(1, weight / ((width * height) / (stride * stride)));

      trackingRef.current = {
        cx: smoothedCx,
        cy: smoothedCy,
        vx: smoothedCx - current.cx,
        vy: smoothedCy - current.cy,
        minX: current.minX + (nextMinX - current.minX) * smooth,
        minY: current.minY + (nextMinY - current.minY) * smooth,
        maxX: current.maxX + (nextMaxX - current.maxX) * smooth,
        maxY: current.maxY + (nextMaxY - current.maxY) * smooth,
        area: current.area + (area - current.area) * smooth,
        presence: current.presence + (1 - current.presence) * smooth,
      };

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [maskRef, maskSizeRef]);

  return trackingRef;
}
