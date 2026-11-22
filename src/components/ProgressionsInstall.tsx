"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import styles from "./ProgressionsInstall.module.css";

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
}

const displayMode = "(display-mode: standalone)";

function subscribeDisplayMode(onChange: () => void) {
  const media = window.matchMedia(displayMode);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isStandalone() {
  return window.matchMedia(displayMode).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function installInstructions() {
  const { userAgent, maxTouchPoints } = navigator;
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return <>In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. If you see <b>Open as Web App</b>, make sure it’s on. Tap <b>Add</b>.</>;
  }
  if (/Android/.test(userAgent)) {
    return <>In Chrome, tap <b>More (⋮)</b>. Choose <b>Install and create shortcut</b>, then <b>Install</b>. Some versions call it <b>Add to Home screen</b>.</>;
  }
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) {
    return <>In Safari, open <b>File</b> and choose <b>Add to Dock</b>.</>;
  }
  return <>In desktop Chrome, open <b>More (⋮)</b>, select <b>Cast, save, and share</b>, then <b>Install page as app</b>.</>;
}

export default function ProgressionsInstall() {
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const deferred = useRef<InstallPrompt | null>(null);
  const helpId = useId();

  useEffect(() => {
    function capture(event: Event) {
      event.preventDefault();
      deferred.current = event as InstallPrompt;
    }
    function finish() {
      deferred.current = null;
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", finish);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", finish);
      deferred.current = null;
    };
  }, []);

  async function install() {
    if (showHelp) {
      setShowHelp(false);
      return;
    }
    const event = deferred.current;
    if (!event) {
      setShowHelp(true);
      return;
    }
    // The browser accepts each event once and requires a user gesture.
    deferred.current = null;
    setPrompting(true);
    try {
      await event.prompt();
    } catch {
      setShowHelp(true);
    } finally {
      setPrompting(false);
    }
  }

  if (standalone || installed) return null;
  return <div className={styles.install}>
    <button type="button" className={styles.button} onClick={install} disabled={prompting}
      aria-expanded={showHelp} aria-controls={helpId}>
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v10m-4-4 4 4 4-4M5 15v4h14v-4" />
      </svg>
      Add to Home Screen
    </button>
    <p className={styles.help} id={helpId} hidden={!showHelp}>
      {showHelp && installInstructions()}
    </p>
  </div>;
}
