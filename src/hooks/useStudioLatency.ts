"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const KEY_PREFIX = "bodysynth.studio.latencyMs.input:";

function readLatency(deviceId: string): number | null {
  try {
    // The former global value has no known input identity; never migrate it
    // onto an arbitrary device, particularly from a microphone to the Spark.
    const stored = localStorage.getItem(KEY_PREFIX + encodeURIComponent(deviceId));
    const value = stored === null || stored.trim() === "" ? NaN : Number(stored);
    return Number.isInteger(value) && value >= 0 && value <= 500 ? value : null;
  } catch { return null; }
}

export function useStudioLatency(deviceId: string | null) {
  const [values, setValues] = useState(() => new Map<string, number | null>());
  const valuesRef = useRef(values);
  const latencyMs = useMemo(() => deviceId
    ? values.has(deviceId) ? values.get(deviceId)! : readLatency(deviceId)
    : null, [deviceId, values]);
  const setLatencyMs = useCallback((value: number | null) => {
    if (!deviceId || (value !== null && (!Number.isInteger(value) || value < 0 || value > 500))) return;
    const next = new Map(valuesRef.current).set(deviceId, value);
    valuesRef.current = next;
    setValues(next);
    try {
      const key = KEY_PREFIX + encodeURIComponent(deviceId);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* Keep the device-specific value in this session. */ }
  }, [deviceId]);

  // A connection can finish before React renders the new selected device.
  // Resolve compensation for the actual attached input at recording time.
  const getLatencyMs = useCallback((connectedDeviceId: string | null) => connectedDeviceId
    ? valuesRef.current.has(connectedDeviceId) ? valuesRef.current.get(connectedDeviceId)!
      : readLatency(connectedDeviceId)
    : null, []);
  return { latencyMs, setLatencyMs, getLatencyMs };
}
