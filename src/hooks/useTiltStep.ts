"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useHeadMotion } from "@/lib/headMotion";
import { readTiltStep } from "@/lib/headMotionGestures";

export function useTiltStep(onStep: (direction: -1 | 1) => void) {
  const degrees = useHeadMotion();
  const armed = useRef(false);
  const act = useEffectEvent(onStep);
  useEffect(() => {
    const next = readTiltStep(armed.current, degrees);
    armed.current = next.armed;
    if (next.step !== 0) act(next.step);
  }, [degrees]);
}
