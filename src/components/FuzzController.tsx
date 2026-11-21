"use client";

import { useEffect, useState } from "react";
import { useTouchDesigner } from "@/hooks/useTouchDesigner";
import { HEAD_TILT_CAPABILITY, isHeadTiltPhoneAddress } from "@/lib/touchdesigner/protocol";
import styles from "./FuzzController.module.css";

export default function FuzzController() {
  const engine = useTouchDesigner();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const ready = engine.status === "ready";
  const pairing = engine.status === "connecting" || engine.status === "handshaking";
  const supported = ready && engine.capabilities?.parameters.includes(HEAD_TILT_CAPABILITY);
  const { requestHeadTiltStatus, disconnect } = engine;
  const tilt = engine.headTilt;

  useEffect(() => {
    if (!supported) return;
    const refresh = () => {
      if (document.visibilityState === "visible") requestHeadTiltStatus();
    };
    refresh();
    const timer = window.setInterval(refresh, 350);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pagehide", disconnect);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pagehide", disconnect);
    };
  }, [supported, requestHeadTiltStatus, disconnect]);

  return (
    <section className={styles.panel} aria-labelledby="airpods-title">
      <h2 id="airpods-title">AirPods head tilt</h2>
      <p className={styles.intro}>Pair this page with Fuzz on your Mac. Connect your AirPods to your iPhone, then use Fuzz Head Tilt on the phone to send your movement while you play.</p>
      {!ready ? (
        <form className={styles.form} onSubmit={(event) => {
          event.preventDefault();
          if (pairing) return;
          engine.connect(code.trim());
          setCode("");
        }}>
          <label htmlFor="fuzz-code">Fuzz pairing code</label>
          <div className={styles.row}>
            <input id="fuzz-code" type="password" value={code} maxLength={128} autoComplete="off"
              disabled={pairing} onChange={(event) => setCode(event.target.value)} />
            {pairing ? <button type="button" onClick={disconnect}>Cancel pairing</button>
              : <button type="submit" disabled={code.trim().length < 8}>Pair with Fuzz</button>}
          </div>
          <details className={styles.help}>
            <summary>Where is the pairing code?</summary>
            <p>Open <code>touchdesigner/fuzz/fuzz.toe</code> in TouchDesigner on this Mac. In its Textport, run <code>{"print(op('/project1/fuzz').fetch('pairingCode'))"}</code> and paste the result above.</p>
          </details>
        </form>
      ) : (
        <>
          <div className={styles.connection}>
            <span>Paired with local Fuzz</span>
            <button type="button" onClick={disconnect}>Disconnect</button>
          </div>
          {supported ? (
            <>
              <div className={styles.instrument}>
                <label htmlFor="airpods-roll">Tilt from center</label>
                <div className={styles.readout}>
                  <output aria-live="off">{tilt?.degrees != null ? `${Math.round(tilt.degrees)}°` : "—"}</output>
                  <meter id="airpods-roll" min={0} max={25} value={Math.min(25, tilt?.degrees ?? 0)}
                    aria-valuetext={tilt?.degrees != null ? `${Math.round(tilt.degrees)} degrees` : "Waiting for tilt"} />
                </div>
                <p>3° of free movement at center. Full trail at 25°.</p>
              </div>
              <form className={styles.form} onSubmit={(event) => {
                event.preventDefault();
                if (tilt && !tilt.enabled) engine.startHeadTilt(phone.trim());
              }}>
                <label htmlFor="fuzz-phone">iPhone Wi-Fi address</label>
                <div className={styles.row}>
                  <input id="fuzz-phone" value={phone} inputMode="decimal" autoCapitalize="none" spellCheck={false}
                    autoComplete="off" disabled={!tilt || tilt.enabled} placeholder="192.168.1.25"
                    onChange={(event) => setPhone(event.target.value)} />
                  {tilt?.owned ? <>
                    <button type="button" onClick={engine.centerHeadTilt}>Set center</button>
                    <button type="button" onClick={engine.stopHeadTilt}>Stop tracking</button>
                  </> : <button type="submit" disabled={!tilt || tilt.enabled || !isHeadTiltPhoneAddress(phone.trim())}>Start tracking</button>}
                </div>
              </form>
              <p className={styles.status}>{tilt?.status ?? "Reading Fuzz status…"}{tilt?.enabled && !tilt.owned && " · Controlled in another session"}</p>
              <details className={styles.help}>
                <summary>Connect the iPhone sender</summary>
                <p>Put both devices on the same Wi-Fi. On iPhone, open Settings → Wi-Fi and tap the info button beside your network to find its IPv4 address. Enter that address above and select Start tracking.</p>
                <p>Enter the Mac’s IPv4 address shown by Fuzz in the iPhone app and tap Start sending. Hold your playing posture until Tracking appears, then tilt toward either shoulder to lengthen the trail. Keep the sender open while playing.</p>
              </details>
            </>
          ) : <p>Open the <code>touchdesigner/fuzz/fuzz.toe</code> supplied with this version of Body Synth, then disconnect and pair again to use head tilt.</p>}
        </>
      )}
      <details className={styles.help}>
        <summary>Set up Fuzz Head Tilt on iPhone</summary>
        <p>On your Mac, open <code>ios/FuzzTilt.xcodeproj</code> in Xcode. Choose your signing team and iPhone, then run the app. Connect your motion-capable AirPods to the iPhone and allow Motion &amp; Fitness and Local Network access when prompted.</p>
      </details>
      {pairing && <p role="status">Pairing with TouchDesigner…</p>}
      {engine.error && <p role="alert" className={styles.error}>{engine.error}</p>}
    </section>
  );
}
