"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { consumeMotionLink, headMotion, useHeadMotionStatus, type MotionSource } from "@/lib/headMotion";
import { isHeadTiltPhoneAddress } from "@/lib/touchdesigner/protocol";
import styles from "./HeadMotionController.module.css";

const hints: Record<string, string> = {
  "/": "Tilt 15° toward either shoulder to strum the seven strings. Return to center before the next strum. Turn on Sound to hear it.",
  "/guitar": "Tilt toward either shoulder to enlarge the current guitar target cue.",
  "/bass": "Tilt toward either shoulder to enlarge the current bass target cue.",
  "/studio": "Tilt left or right to pan clip playback.",
  "/ascii": "Tilt toward one shoulder for coarser text or the other for finer text.",
  "/for-you": "Tilt 15° left or right to step between practice cards. Return to center before the next step.",
  "/pocket-operators": "Tilt 15° left or right to step between drum parts. Return to center before the next step.",
  "/fuzz": "Tilt toward either shoulder to lengthen the browser camera trail. The Fuzz panel pairs separately with TouchDesigner.",
};

export default function HeadMotionController() {
  const path = usePathname();
  const hint = hints[path];
  return hint ? <MotionPanel hint={hint} left={path === "/ascii"} /> : null;
}

function MotionPanel({ hint, left }: { hint: string; left: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [source, setSource] = useState<MotionSource>("mac");
  const [phone, setPhone] = useState("");
  const state = useHeadMotionStatus();
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const active = state.phase === "active";
  const engaged = active || state.phase === "starting";

  useEffect(() => {
    function acceptPairingLink() {
      const token = consumeMotionLink(window.location, window.history);
      if (token) {
        setCode(token);
        setOpen(true);
      }
    }
    acceptPairingLink();
    window.addEventListener("hashchange", acceptPairingLink);
    const release = () => headMotion.stop("Head motion paused. Select Start to resume.");
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("hashchange", acceptPairingLink);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, []);

  function close() {
    setOpen(false);
    launcher.current?.focus();
  }

  return (
    <aside className={`${styles.dock} ${left ? styles.left : ""}`} aria-label="AirPods head motion"
      onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <button type="button" ref={launcher} className={styles.launcher} aria-controls={id}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={active ? styles.live : styles.dot} aria-hidden="true" />AirPods
        {active && <span className={styles.srOnly}> tracking</span>}
      </button>
      {open && <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>AirPods head motion</h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close AirPods panel">×</button>
        </div>
        <p className={styles.hint}>{hint}</p>
        {!engaged && <form className={styles.form} onSubmit={event => {
          event.preventDefault();
          headMotion.start(code, source, phone);
        }}>
          <label>AirPods connected to
            <select value={source} onChange={event => setSource(event.target.value === "iphone" ? "iphone" : "mac")}>
              <option value="mac">This Mac</option><option value="iphone">iPhone</option>
            </select>
          </label>
          {source === "iphone" && <label>iPhone Wi-Fi IPv4 address
            <input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="off"
              spellCheck={false} placeholder="192.168.1.25" />
          </label>}
          <label>Motion bridge pairing code
            <input value={code} type="password" autoComplete="off" maxLength={128}
              onChange={event => setCode(event.target.value)} />
          </label>
          <button className={styles.primary} type="submit"
            disabled={!code.trim() || (source === "iphone" && !isHeadTiltPhoneAddress(phone.trim()))}>Start</button>
        </form>}
        {engaged && <div className={styles.reading}>
          <span>Tilt from center</span>
          <output aria-live="off">{state.degrees === null ? "—" : `${Math.round(state.degrees)}°`}</output>
          <div className={styles.actions}>
            {active && <button type="button" onClick={() => headMotion.center()}>Set center</button>}
            <button type="button" onClick={() => headMotion.stop()}>{active ? "Stop" : "Cancel"}</button>
          </div>
        </div>}
        {state.status && <p className={styles.status}
          role={state.phase === "error" ? "alert" : state.degrees === null ? "status" : undefined}>{state.status}</p>}
        <details className={styles.setup}>
          <summary>Connect the motion bridge</summary>
          <p>In Terminal on this Mac, run this command from the Body Synth repository. Leave it running. Open the pairing link it prints or enter the code here, then select Start. Allow local device or loopback access if your browser asks.</p>
          <code>python3 scripts/head-motion.py</code>
          {source === "mac" ?
            <p>Connect motion-capable AirPods to this Mac (macOS 14 or later), put them on, and allow Motion &amp; Fitness access when prompted.</p> :
            <p>Connect the AirPods to your iPhone. Join the Mac’s Wi-Fi and find the phone’s IPv4 address in Settings → Wi-Fi → ⓘ. Select Start here, enter the Mac address shown by the bridge in the Fuzz Head Tilt iPhone app, then tap Start sending.</p>}
        </details>
      </section>}
    </aside>
  );
}
