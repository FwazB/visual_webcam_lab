"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { consumeMotionLink, headMotion, useHeadMotionStatus, type MotionSource } from "@/lib/headMotion";
import styles from "./HeadMotionController.module.css";

const installGuide = "https://github.com/FwazB/visual_webcam_lab/tree/main/macos/motion#install-on-another-mac";

const hints: Record<string, string> = {
  "/": "Tilt 15° toward either shoulder to strum the seven strings. Return to center before the next strum. Turn on Sound to hear it.",
  "/guitar": "Tilt toward either shoulder to enlarge the current guitar target cue.",
  "/bass": "Tilt toward either shoulder to enlarge the current bass target cue.",
  "/progressions": "With the loop stopped, tilt left or right to step through chord fingerings. Return to center before the next chord.",
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
  const [manual, setManual] = useState(false);
  const [source, setSource] = useState<MotionSource>("mac");
  const [phone, setPhone] = useState("");
  const state = useHeadMotionStatus();
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const focusOptions = useRef(false);
  const active = state.phase === "active";
  const engaged = active || state.phase === "starting";

  useEffect(() => {
    function acceptPairingLink() {
      const token = consumeMotionLink(window.location, window.history);
      if (token) {
        setCode(token);
        setManual(true);
        setOpen(true);
      }
    }
    acceptPairingLink();
    window.addEventListener("hashchange", acceptPairingLink);
    const release = () => headMotion.stop("Head motion paused. Select Start AirPods to resume.");
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

  function start() {
    setOpen(true);
    if (manual) headMotion.start(code, source, phone);
    else headMotion.startNative(source, phone);
  }

  return (
    <aside className={`${styles.dock} ${left ? styles.left : ""}`} aria-label="AirPods head motion"
      onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <div className={styles.launcher}>
        <button type="button" ref={launcher} className={styles.start} aria-controls={id}
          aria-expanded={engaged || open ? open : undefined} onClick={engaged || open ? () => setOpen(!open) : start}>
          <span className={active ? styles.live : styles.dot} aria-hidden="true" />
          {active ? "AirPods on" : engaged ? "Connecting…" : open ? "AirPods" : "Start AirPods"}
        </button>
        {!engaged && !open && <button type="button" className={styles.options} aria-expanded={false} aria-controls={id}
          aria-label="AirPods options" title="AirPods options" onClick={() => { focusOptions.current = true; setOpen(true); }}>
          <span aria-hidden="true">⌃</span>
        </button>}
      </div>
      {open && <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>AirPods head motion</h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close AirPods panel">×</button>
        </div>
        <p className={styles.hint}>{hint}</p>
        {!engaged && <form className={styles.form} onSubmit={event => {
          event.preventDefault();
          start();
        }}>
          <label>AirPods connected to
            <select ref={element => {
              if (element && focusOptions.current) { focusOptions.current = false; element.focus(); }
            }} value={source} onChange={event => setSource(event.target.value === "iphone" ? "iphone" : "mac")}>
              <option value="mac">This Mac</option><option value="iphone">iPhone</option>
            </select>
          </label>
          {source === "iphone" && <label>iPhone Wi-Fi IPv4 address
            <input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="off"
              spellCheck={false} placeholder="192.168.1.25" />
          </label>}
          <label>Connection
            <select value={manual ? "manual" : "app"} onChange={event => setManual(event.target.value === "manual")}>
              <option value="app">Body Synth Motion app</option><option value="manual">Manual pairing code</option>
            </select>
          </label>
          {manual && <label>Motion bridge pairing code
            <input value={code} type="password" autoComplete="off" maxLength={128}
              onChange={event => setCode(event.target.value)} />
          </label>}
          <button className={styles.primary} type="submit">Start AirPods</button>
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
        {source === "iphone" && <p className={styles.help}>Connect AirPods to your iPhone and join the Mac’s Wi-Fi.
          Find the iPhone address in Settings → Wi-Fi → ⓘ. After starting here, enter the Mac address shown above
          in the Fuzz Head Tilt iPhone app and tap Start sending.</p>}
        {!engaged && (manual ? <div className={styles.setup}>
          <p>From the Body Synth repository on this Mac, run the bridge and leave it open. Use its pairing link or enter its code here.</p>
          <code>python3 scripts/head-motion.py</code>
        </div> : <div className={styles.setup}>
          {source === "mac" && <p>Wear your AirPods and connect them to this Mac (macOS 14 or later). Allow Motion &amp; Fitness access if asked.</p>}
          <a href={installGuide} target="_blank" rel="noreferrer">Install Body Synth Motion on another Mac ↗</a>
        </div>)}
      </section>}
    </aside>
  );
}
