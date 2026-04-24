"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildFretboardHomography,
  type FretboardHomography,
  type Point,
} from "@/lib/bass/homography";

export const CALIBRATION_LABELS = [
  "Tap the NUT × E string (thickest)",
  "Tap the 12th FRET × E string",
  "Tap the 12th FRET × G string (thinnest)",
  "Tap the NUT × G string",
] as const;

export type CalibrationStep = 0 | 1 | 2 | 3 | 4; // 4 = complete

export function useFretboardCalibration() {
  const [points, setPoints] = useState<Point[]>([]);

  const addPoint = useCallback((p: Point) => {
    setPoints((prev) => (prev.length >= 4 ? prev : [...prev, p]));
  }, []);

  const undo = useCallback(() => {
    setPoints((prev) => prev.slice(0, -1));
  }, []);

  const reset = useCallback(() => {
    setPoints([]);
  }, []);

  const homography: FretboardHomography | null = useMemo(() => {
    if (points.length !== 4) return null;
    return buildFretboardHomography(points[0], points[1], points[2], points[3]);
  }, [points]);

  const step: CalibrationStep = Math.min(points.length, 4) as CalibrationStep;
  const isComplete = step === 4;
  const currentLabel = step < 4 ? CALIBRATION_LABELS[step as 0 | 1 | 2 | 3] : null;

  return {
    points,
    step,
    isComplete,
    currentLabel,
    homography,
    addPoint,
    undo,
    reset,
  };
}
