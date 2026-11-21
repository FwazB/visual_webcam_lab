"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHeadMotion } from "@/lib/headMotion";
import { headTiltAmount } from "@/lib/headMotionGestures";
import { renderCameraTrails } from "@/lib/cameraTrails";
import styles from "@/app/fuzz/page.module.css";

export default function BrowserFuzz() {
  const degrees = useHeadMotion();
  const amount = Math.abs(headTiltAmount(degrees));
  const trail = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const capture = useRef<AbortController | null>(null);
  const [state, setState] = useState<"off" | "opening" | "live">("off");
  const [error, setError] = useState("");

  useEffect(() => { trail.current = amount; }, [amount]);

  const stop = useCallback(() => {
    capture.current?.abort();
    capture.current = null;
    setState("off");
  }, []);

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [stop]);

  async function start() {
    if (capture.current || !canvas.current) return;
    const session = new AbortController();
    capture.current = session;
    setState("opening");
    setError("");
    try {
      await renderCameraTrails(canvas.current, session.signal, () => trail.current, () => {
        stop();
        setError("Camera disconnected.");
      });
      if (!session.signal.aborted) setState("live");
    } catch {
      if (!session.signal.aborted) {
        stop();
        setError("Couldn’t open the camera. Check the selected device and camera permission, then try again.");
      }
    }
  }

  return <section className={styles.browser} aria-labelledby="camera-trails">
    <h2 id="camera-trails">Camera trails</h2>
    <p>Start the camera, then connect AirPods using the website’s AirPods control. Tilt toward either shoulder to leave a longer trail as you move.</p>
    <canvas ref={canvas} hidden={state !== "live"} aria-label="Mirrored live camera with a motion-controlled trail" />
    <button type="button" onClick={state === "off" ? start : stop}>{state === "off" ? "Start camera" : state === "opening" ? "Cancel camera" : "Stop camera"}</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
