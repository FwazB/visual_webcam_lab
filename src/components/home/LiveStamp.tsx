"use client";

// Taped "LIVE" tag with the visitor's local date and time, ticking each second.

import { useSyncExternalStore } from "react";
import styles from "./home.module.css";

function subscribe(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const pad = (n: number) => String(n).padStart(2, "0");

export default function LiveStamp() {
  // 0 on the server: the tag renders its frame, the time fills in on the client.
  const seconds = useSyncExternalStore(subscribe, nowSeconds, () => 0);
  const d = seconds ? new Date(seconds * 1000) : null;
  return (
    <p className={styles.stamp}>
      <span className={styles.stampLive}>
        <span className={styles.dot} aria-hidden="true" /> live
        <span className={styles.stampTime}>{d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "--:--:--"}</span>
      </span>
      <span className={styles.stampDate}>{d ? `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : "----.--.--"}</span>
    </p>
  );
}
