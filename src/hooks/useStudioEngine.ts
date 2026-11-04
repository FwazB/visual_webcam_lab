"use client";

// Owns the studio's audio engine (created on the first user gesture) and its
// input device: the Spark over USB is preferred, as in the trainer.

import { useCallback, useEffect, useRef, useState } from "react";
import { instrumentConstraints, listAudioInputs, pickPreferredDevice, storeDevice } from "@/lib/audio/devices";
import { StudioEngine } from "@/lib/studio/engine";

type InputStatus = "off" | "connecting" | "ready" | "needs-device" | "suspended" | "muted" | "error";
interface InputLevel { peak: number; rms: number; channels: number }

export function useStudioEngine() {
  const engineRef = useRef<StudioEngine | null>(null);
  const creatingRef = useRef<Promise<StudioEngine> | null>(null);
  const mountedRef = useRef(true);
  const lifetimeRef = useRef(0);
  const inputRequestRef = useRef(0);
  const activationRequestRef = useRef(0);
  const enumerationRef = useRef<AbortController | null>(null);
  const inputStatusRef = useRef<InputStatus>("off");
  const connectedDeviceRef = useRef<string | null>(null);
  const [inputStatus, setInputStatus] = useState<InputStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [latencyEstimateMs, setLatencyEstimateMs] = useState(0);
  const [inputLevel, setInputLevel] = useState<InputLevel | null>(null);
  const [audioPaused, setAudioPaused] = useState(false);

  const updateStatus = useCallback((next: InputStatus) => {
    inputStatusRef.current = next;
    setInputStatus(next);
  }, []);

  const syncInput = useCallback(() => {
    const engine = engineRef.current;
    if (!mountedRef.current || !engine) return;
    setAudioPaused(engine.ctx.state !== "running" && engine.ctx.state !== "closed");
    const level = engine.getInputLevel();
    const next = level ? {
      peak: Math.round(Math.max(0, ...level.peaks) * 10000) / 10000,
      rms: Math.round(Math.max(0, ...level.rms) * 10000) / 10000,
      channels: level.peaks.length,
    } : null;
    setInputLevel(previous => previous?.peak === next?.peak && previous?.rms === next?.rms
      && previous?.channels === next?.channels ? previous : next);
    if (!connectedDeviceRef.current || ["connecting", "needs-device", "error"].includes(inputStatusRef.current)) return;
    if (!engine.hasInput || engine.ctx.state === "closed") {
      setError(engine.ctx.state === "closed" ? "Studio audio stopped. Connect the input again."
        : "Audio input disconnected. Reconnect the Spark or choose an available input.");
      updateStatus("error");
    } else if (engine.ctx.state !== "running") updateStatus("suspended");
    else if (engine.inputMuted) updateStatus("muted");
    else updateStatus("ready");
  }, [updateStatus]);

  /** Create the engine (must follow a user gesture the first time). */
  const ensureEngine = useCallback(() => {
    if (!mountedRef.current) return Promise.reject(new Error("Studio is no longer open."));
    const existing = engineRef.current;
    if (existing && existing.ctx.state !== "closed") {
      // Invoke resume in the click handler, before device discovery or imports
      // consume the user gesture. Transport actions still await it explicitly.
      void existing.resume().catch(() => {});
      return Promise.resolve(existing);
    }
    if (existing) {
      const hadInput = connectedDeviceRef.current !== null;
      existing.close();
      engineRef.current = null;
      creatingRef.current = null;
      connectedDeviceRef.current = null;
      setDeviceId(null);
      setInputLevel(null);
      setAudioPaused(false);
      if (inputStatusRef.current !== "connecting") {
        updateStatus("off");
        setError(hadInput ? "Studio audio restarted. Connect the input again." : null);
      }
    }
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
  }, [updateStatus]);

  const resumeAudio = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !mountedRef.current) return;
    const lifetime = lifetimeRef.current;
    const inputRequest = inputRequestRef.current;
    const activationRequest = ++activationRequestRef.current;
    const current = () => mountedRef.current && lifetime === lifetimeRef.current && engineRef.current === engine
      && inputRequest === inputRequestRef.current && activationRequest === activationRequestRef.current;
    try {
      await engine.resume();
      if (!current()) return;
      setError(null);
      syncInput();
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : String(err));
    }
  }, [syncInput]);

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
      connectedDeviceRef.current = id;
      setLatencyEstimateMs(latencyMs);
      updateStatus(engine.ctx.state !== "running" ? "suspended" : engine.inputMuted ? "muted" : "ready");
      syncInput();
    } catch (err) {
      if (!current()) return;
      storeDevice(null);
      setError(err instanceof Error ? err.message : String(err));
      updateStatus("error");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }, [ensureEngine, syncInput, updateStatus]);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    const request = ++inputRequestRef.current;
    enumerationRef.current?.abort();
    const controller = new AbortController();
    enumerationRef.current = controller;
    updateStatus("connecting");
    setError(null);
    try {
      // Create/resume the context while this call still belongs to the click.
      // Do not wait for it before asking for microphone permission.
      const creating = ensureEngine();
      void creating.catch(() => {});
      const list = await listAudioInputs(controller.signal);
      if (!mountedRef.current || request !== inputRequestRef.current) return;
      await creating;
      if (!mountedRef.current || request !== inputRequestRef.current) return;
      setDevices(list);
      const preferred = pickPreferredDevice(list);
      if (!preferred) {
        updateStatus("needs-device");
        return;
      }
      storeDevice(preferred);
      await openDevice(preferred.deviceId, request);
    } catch (err) {
      if (!mountedRef.current || request !== inputRequestRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      updateStatus("error");
    } finally {
      if (enumerationRef.current === controller) enumerationRef.current = null;
    }
  }, [ensureEngine, openDevice, updateStatus]);

  const selectDevice = useCallback((id: string) => {
    if (!mountedRef.current) return;
    const request = ++inputRequestRef.current;
    enumerationRef.current?.abort();
    enumerationRef.current = null;
    updateStatus("connecting");
    setError(null);
    storeDevice(devices.find((d) => d.deviceId === id) ?? null);
    void openDevice(id, request);
  }, [devices, openDevice, updateStatus]);

  /** Cancel a pending permission/device change without disconnecting an existing input. */
  const cancelPendingInput = useCallback(() => {
    inputRequestRef.current++;
    enumerationRef.current?.abort();
    enumerationRef.current = null;
    if (mountedRef.current) {
      updateStatus(engineRef.current?.hasInput ? "ready" : "off");
      syncInput();
    }
  }, [syncInput, updateStatus]);

  /** Re-read the latency estimate (it settles once audio is running). */
  const refreshLatency = useCallback(() => {
    const ms = Math.round((engineRef.current?.estimatedLatency() ?? 0) * 1000);
    setLatencyEstimateMs(ms);
    return ms;
  }, []);

  /** The attached source is updated before React renders its selected label. */
  const getConnectedDeviceId = useCallback(() => engineRef.current?.hasInput ? connectedDeviceRef.current : null, []);

  useEffect(() => {
    mountedRef.current = true;
    lifetimeRef.current++;
    const timer = window.setInterval(syncInput, 100);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
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
  }, [syncInput]);

  return { engineRef, ensureEngine, inputStatus, inputLevel, audioPaused, error, devices, deviceId, connect, selectDevice, resumeAudio, cancelPendingInput, latencyEstimateMs, refreshLatency, getConnectedDeviceId };
}
