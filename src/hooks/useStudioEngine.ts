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
  const mountedRef = useRef(true);
  const lifetimeRef = useRef(0);
  const inputRequestRef = useRef(0);
  const enumerationRef = useRef<AbortController | null>(null);
  const [inputStatus, setInputStatus] = useState<InputStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [latencyEstimateMs, setLatencyEstimateMs] = useState(0);

  /** Create the engine (must follow a user gesture the first time). */
  const ensureEngine = useCallback(() => {
    if (!mountedRef.current) return Promise.reject(new Error("Studio is no longer open."));
    if (creatingRef.current) return creatingRef.current;
    const lifetime = lifetimeRef.current;
    const pending = StudioEngine.create().then((engine) => {
      if (!mountedRef.current || lifetime !== lifetimeRef.current) {
        engine.close();
        throw new Error("Studio is no longer open.");
      }
      engineRef.current = engine;
      return engine;
    }).catch((err) => {
      if (creatingRef.current === pending) creatingRef.current = null;
      throw err;
    });
    creatingRef.current = pending;
    return pending;
  }, []);

  const openDevice = useCallback(async (id: string, request: number) => {
    const current = () => mountedRef.current && request === inputRequestRef.current;
    let stream: MediaStream | null = null;
    try {
      const engine = await ensureEngine();
      if (!current()) return;
      stream = await navigator.mediaDevices.getUserMedia(instrumentConstraints(id, 2));
      if (!current()) return;
      engine.attachInput(stream);
      const latencyMs = Math.round(engine.estimatedLatency() * 1000);
      stream = null; // Ownership transfers only after a successful attachment.
      setDeviceId(id);
      setLatencyEstimateMs(latencyMs);
      setInputStatus("ready");
    } catch (err) {
      if (!current()) return;
      storeDevice(null);
      setError(err instanceof Error ? err.message : String(err));
      setInputStatus("error");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }, [ensureEngine]);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const request = ++inputRequestRef.current;
    enumerationRef.current?.abort();
    const controller = new AbortController();
    enumerationRef.current = controller;
    setInputStatus("connecting");
    setError(null);
    try {
      const list = await listAudioInputs(controller.signal);
      if (!mountedRef.current || request !== inputRequestRef.current) return;
      setDevices(list);
      const preferred = pickPreferredDevice(list);
      if (!preferred) {
        setInputStatus("needs-device");
        return;
      }
      storeDevice(preferred);
      await openDevice(preferred.deviceId, request);
    } catch (err) {
      if (!mountedRef.current || request !== inputRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setInputStatus("error");
    } finally {
      if (enumerationRef.current === controller) enumerationRef.current = null;
    }
  }, [openDevice]);

  const selectDevice = useCallback((id: string) => {
    if (!mountedRef.current) return;
    const request = ++inputRequestRef.current;
    enumerationRef.current?.abort();
    enumerationRef.current = null;
    setInputStatus("connecting");
    setError(null);
    storeDevice(devices.find((d) => d.deviceId === id) ?? null);
    void openDevice(id, request);
  }, [devices, openDevice]);

  /** Cancel a pending permission/device change without disconnecting an existing input. */
  const cancelPendingInput = useCallback(() => {
    inputRequestRef.current++;
    enumerationRef.current?.abort();
    enumerationRef.current = null;
    if (mountedRef.current) setInputStatus(engineRef.current?.hasInput ? "ready" : "off");
  }, []);

  /** Re-read the latency estimate (it settles once audio is running). */
  const refreshLatency = useCallback(() => {
    const ms = Math.round((engineRef.current?.estimatedLatency() ?? 0) * 1000);
    setLatencyEstimateMs(ms);
    return ms;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    lifetimeRef.current++;
    return () => {
      mountedRef.current = false;
      lifetimeRef.current = lifetimeRef.current + 1;
      inputRequestRef.current = inputRequestRef.current + 1;
      enumerationRef.current?.abort();
      enumerationRef.current = null;
      const engine = engineRef.current;
      creatingRef.current = null;
      engineRef.current = null;
      engine?.close();
      // The creation continuation closes any engine that resolves after this lifetime.
    };
  }, []);

  return { engineRef, ensureEngine, inputStatus, error, devices, deviceId, connect, selectDevice, cancelPendingInput, latencyEstimateMs, refreshLatency };
}
