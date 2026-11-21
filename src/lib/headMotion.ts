"use client";

import { useSyncExternalStore } from "react";
import { isHeadTiltPhoneAddress } from "@/lib/touchdesigner/protocol";

export const MOTION_URL = "http://127.0.0.1:9982/motion";
export type MotionSource = "mac" | "iphone";
type Phase = "idle" | "starting" | "active" | "error";
type Snapshot = { phase: Phase; status: string; degrees: number | null };
type Command = { action: "start"; source: MotionSource; phone?: string } | { action: "status" | "center" | "stop" };
type Reply = { enabled: boolean; owned: boolean; status: string; degrees: number | null };
type Session = {
  id: string;
  code: string;
  launchDeadline: number | null;
  request: AbortController | null;
  poll: ReturnType<typeof setTimeout> | null;
  expiry: ReturnType<typeof setTimeout> | null;
  centerPending: boolean;
  failures: number;
};

const INITIAL: Snapshot = { phase: "idle", status: "", degrees: null };
const POLL_MS = 200;
const FRESH_MS = 750;
const LAUNCH_WAIT_MS = 45_000;
const COMPANION_UNAVAILABLE = "Couldn’t connect to Body Synth Motion. Check that the app is installed on this Mac, allow local network access in your browser, then select Start AirPods again.";

/** The bridge prints this exact home-page fragment. Other anchors and OAuth URLs are untouched. */
export function consumeMotionLink(location: Pick<Location, "origin" | "pathname" | "hash" | "search">,
  history: Pick<History, "replaceState" | "state">) {
  if (location.origin !== "https://body-synth-beta.vercel.app" || location.pathname !== "/" || location.search !== "") return null;
  const match = /^#motion-code=([A-Za-z0-9_-]{24})$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(history.state, "", "/");
  return match[1];
}

function isReply(value: unknown): value is Reply {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.enabled === "boolean" && typeof record.owned === "boolean" &&
    typeof record.status === "string" && record.status.length <= 512 &&
    (record.degrees === null || (typeof record.degrees === "number" && Number.isFinite(record.degrees) && Math.abs(record.degrees) <= 180));
}

class BridgeError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export class HeadMotionClient {
  private state = INITIAL;
  private session: Session | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private fetcher: typeof fetch = (...args) => fetch(...args),
    private openCompanion = (url: string) => window.location.assign(url),
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.state;
  degrees = () => this.state.degrees;

  private update(phase: Phase, status: string, degrees: number | null = null) {
    if (this.state.phase === phase && this.state.status === status && this.state.degrees === degrees) return;
    this.state = { phase, status, degrees };
    for (const listener of this.listeners) listener();
  }

  start(code: string, source: MotionSource, phone: string) {
    this.begin(source, phone, code.trim());
  }

  startNative(source: MotionSource = "mac", phone = "") {
    this.begin(source, phone, null);
  }

  private begin(source: MotionSource, phone: string, manualCode: string | null) {
    if (this.session) return;
    phone = phone.trim();
    if (manualCode !== null && !/^[!-~]{1,128}$/.test(manualCode)) {
      this.update("error", "Enter the pairing code printed in Terminal."); return;
    }
    if (source === "iphone" && !isHeadTiltPhoneAddress(phone)) {
      this.update("error", "Enter the iPhone’s Wi-Fi IPv4 address."); return;
    }
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      this.update("error", "Open Body Synth over HTTPS or localhost to pair with the motion bridge."); return;
    }
    // A new private ID per activation prevents a delayed Stop from an old
    // tab session from cancelling a later run. It survives client navigation.
    const code = manualCode ?? Array.from(crypto.getRandomValues(new Uint8Array(32)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    const run: Session = {
      id: crypto.randomUUID(), code, launchDeadline: manualCode === null ? Date.now() + LAUNCH_WAIT_MS : null,
      request: null, poll: null, expiry: null, centerPending: false, failures: 0,
    };
    this.session = run;
    if (manualCode === null) {
      this.update("starting", "Opening Body Synth Motion… Choose Open if your browser asks, and allow local network access.");
      // Keep the external protocol hand-off on the original click stack.
      try { this.openCompanion(`bodysynth-motion://connect/${code}`); }
      catch { this.end(run); this.update("error", COMPANION_UNAVAILABLE); return; }
    } else {
      this.update("starting", "Connecting to the motion bridge…");
    }
    void this.exchange(run, source === "mac" ? { action: "start", source } : { action: "start", source, phone });
  }

  center() {
    const run = this.session;
    if (!run || this.state.phase !== "active") return;
    if (run.request) { run.centerPending = true; return; }
    if (run.poll !== null) clearTimeout(run.poll);
    void this.exchange(run, { action: "center" });
  }

  stop(message = "Head motion stopped.") {
    const run = this.session;
    if (!run) return;
    this.end(run);
    this.update("idle", message);
    void this.send(run, { action: "stop" }, true).catch(() => { /* The bridge lease also expires. */ });
  }

  private end(run: Session) {
    this.session = null;
    if (run.poll !== null) clearTimeout(run.poll);
    if (run.expiry !== null) clearTimeout(run.expiry);
    run.request?.abort();
  }

  private async exchange(run: Session, command: Command) {
    if (this.session !== run) return;
    // A browser permission sheet or sleeping Mac can delay a scheduled retry.
    if (command.action === "start" && run.launchDeadline !== null && Date.now() >= run.launchDeadline) {
      this.stop();
      this.update("error", COMPANION_UNAVAILABLE);
      return;
    }
    try {
      const reply = await this.send(run, command);
      if (this.session !== run) return;
      if (!reply.enabled || !reply.owned) {
        this.end(run);
        this.update("idle", reply.owned || !reply.enabled ? reply.status : "Another session controls head motion.");
        return;
      }
      run.failures = 0;
      this.update("active", reply.status, reply.degrees);
      if (run.expiry !== null) clearTimeout(run.expiry);
      run.expiry = setTimeout(() => {
        if (this.session === run) this.update("active", "Waiting for a fresh motion reading…");
      }, FRESH_MS);
    } catch (error) {
      if (this.session !== run) return;
      // The app can be cold, or the browser's first POST can beat the URL
      // hand-off to an already-running app. Only replay this tab's own Start.
      if (command.action === "start" && run.launchDeadline !== null && (!(error instanceof BridgeError) || error.status === 401)) {
        const delay = Math.min(500 * ++run.failures, 1500);
        if (Date.now() + delay < run.launchDeadline) {
          run.poll = setTimeout(() => { void this.exchange(run, command); }, delay);
          return;
        }
        this.stop();
        this.update("error", COMPANION_UNAVAILABLE);
        return;
      } else if (command.action === "status" && !(error instanceof BridgeError) && ++run.failures < 3) {
        this.update("active", "Motion bridge interrupted. Reconnecting…");
      } else {
        this.stop();
        this.update("error", error instanceof BridgeError ? error.message : run.launchDeadline !== null ? COMPANION_UNAVAILABLE :
          "Could not reach the motion bridge. Run the Terminal command on this Mac and allow the browser to access local devices or loopback, then try again.");
        return;
      }
    }
    if (this.session !== run) return;
    if (run.centerPending) {
      run.centerPending = false;
      void this.exchange(run, { action: "center" });
    } else {
      run.poll = setTimeout(() => { void this.exchange(run, { action: "status" }); }, POLL_MS);
    }
  }

  private async send(run: Session, command: Command, keepalive = false): Promise<Reply> {
    const abort = new AbortController();
    if (!keepalive) run.request = abort;
    const requestLimit = command.action === "start" ? 30_000 : 1000;
    const timeoutMs = command.action === "start" && run.launchDeadline !== null
      ? Math.max(1, Math.min(requestLimit, run.launchDeadline - Date.now())) : requestLimit;
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const options: RequestInit & { targetAddressSpace: "loopback" } = {
        method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
        redirect: "error", referrerPolicy: "no-referrer", targetAddressSpace: "loopback", keepalive, signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.code}`, "X-Motion-Session": run.id },
        body: JSON.stringify(command),
      };
      const response = await this.fetcher(MOTION_URL, options);
      if (response.status === 401) throw new BridgeError(run.launchDeadline === null
        ? "Check the pairing code printed by the motion bridge in Terminal."
        : "Body Synth Motion disconnected. Select Start AirPods to reconnect.", 401);
      const payload: unknown = await response.json().catch(error => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
        throw new BridgeError(typeof message === "string" && message.length <= 400 && !message.includes(run.code)
          ? message : "The local bridge rejected this request. Try starting again.");
      }
      if (!isReply(payload)) throw new BridgeError("The motion bridge sent an invalid reading. Restart the motion bridge and try again.");
      return payload;
    } finally {
      clearTimeout(timeout);
      if (run.request === abort) run.request = null;
    }
  }
}

export const headMotion = new HeadMotionClient();
export function useHeadMotion(): number | null {
  return useSyncExternalStore(headMotion.subscribe, headMotion.degrees, () => null);
}
export function useHeadMotionStatus() {
  return useSyncExternalStore(headMotion.subscribe, headMotion.snapshot, () => INITIAL);
}
