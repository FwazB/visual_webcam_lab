"use client";

// Owns the studio's audio engine (created on the first user gesture) and its
// input device: the Spark over USB is preferred, as in the trainer.

import { useCallback, useEffect, useRef, useState } from "react";
import { instrumentConstraints, listAudioInputs, pickPreferredDevice, storeDevice } from "@/lib/audio/devices";
import { StudioEngine } from "@/lib/studio/engine";

type InputStatus = "off" | "connecting" | "ready" | "needs-device" | "error";

export function useStudioEngine() {
  const engineRef = useRef<StudioEngine | null>(null);
  const creatingRef = useRef<Promise<StudioEngine> | null>(null);
  const [inputStatus, setInputStatus] = useState<InputStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [latencyEstimateMs, setLatencyEstimateMs] = useState(0);

  /** Create the engine (must follow a user gesture the first time). */
  const ensureEngine = useCallback(() => {
    creatingRef.current ??= StudioEngine.create().then(
      (engine) => {
        engineRef.current = engine;
        return engine;
      },
      (err) => {
        creatingRef.current = null;
        throw err;
      },
    );
    return creatingRef.current;
  }, []);

  const openDevice = useCallback(async (id: string) => {
    setInputStatus("connecting");
    setError(null);
    try {
      const engine = await ensureEngine();
      const stream = await navigator.mediaDevices.getUserMedia(instrumentConstraints(id, 2));
      engine.attachInput(stream);
      setDeviceId(id);
      setLatencyEstimateMs(Math.round(engine.estimatedLatency() * 1000));
      setInputStatus("ready");
    } catch (err) {
      storeDevice(null);
      setError(err instanceof Error ? err.message : String(err));
      setInputStatus("error");
    }
  }, [ensureEngine]);

  const connect = useCallback(async () => {
    setInputStatus("connecting");
    setError(null);
    try {
      const list = await listAudioInputs();
      setDevices(list);
      const preferred = pickPreferredDevice(list);
      if (!preferred) {
        setInputStatus("needs-device");
        return;
      }
      storeDevice(preferred);
      await openDevice(preferred.deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInputStatus("error");
    }
  }, [openDevice]);

  const selectDevice = useCallback((id: string) => {
    storeDevice(devices.find((d) => d.deviceId === id) ?? null);
    void openDevice(id);
  }, [devices, openDevice]);

  /** Re-read the latency estimate (it settles once audio is running). */
  const refreshLatency = useCallback(() => {
    const ms = Math.round((engineRef.current?.estimatedLatency() ?? 0) * 1000);
    setLatencyEstimateMs(ms);
    return ms;
  }, []);

  useEffect(() => () => {
    const pending = creatingRef.current;
    creatingRef.current = null;
    engineRef.current = null;
    pending?.then((engine) => engine.close(), () => {});
  }, []);

  return { engineRef, ensureEngine, inputStatus, error, devices, deviceId, connect, selectDevice, latencyEstimateMs, refreshLatency };
}
