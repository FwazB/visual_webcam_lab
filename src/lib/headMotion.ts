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
  request: AbortController | null;
  poll: ReturnType<typeof setTimeout> | null;
  expiry: ReturnType<typeof setTimeout> | null;
  centerPending: boolean;
  failures: number;
};

const INITIAL: Snapshot = { phase: "idle", status: "", degrees: null };
const POLL_MS = 200;
const FRESH_MS = 750;

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

class BridgeError extends Error {}

export class HeadMotionClient {
  private state = INITIAL;
  private session: Session | null = null;
  private listeners = new Set<() => void>();

  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}

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
    if (this.session) return;
    code = code.trim();
    phone = phone.trim();
    if (!/^[!-~]{1,128}$/.test(code)) { this.update("error", "Enter the pairing code printed in Terminal."); return; }
    if (source === "iphone" && !isHeadTiltPhoneAddress(phone)) {
      this.update("error", "Enter the iPhone’s Wi-Fi IPv4 address."); return;
    }
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      this.update("error", "Open Body Synth over HTTPS or localhost to pair with the motion bridge."); return;
    }
    // A new private ID per activation prevents a delayed Stop from an old
    // tab session from cancelling a later run. It survives client navigation.
    const run: Session = { id: crypto.randomUUID(), code, request: null, poll: null, expiry: null, centerPending: false, failures: 0 };
    this.session = run;
    this.update("starting", "Connecting to the motion bridge…");
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
      if (command.action === "status" && !(error instanceof BridgeError) && ++run.failures < 3) {
        this.update("active", "Motion bridge interrupted. Reconnecting…");
      } else {
        this.stop();
        this.update("error", error instanceof BridgeError ? error.message :
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
    const timeout = setTimeout(() => abort.abort(), command.action === "start" ? 30_000 : 1000);
    try {
      const options: RequestInit & { targetAddressSpace: "loopback" } = {
        method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
        redirect: "error", referrerPolicy: "no-referrer", targetAddressSpace: "loopback", keepalive, signal: abort.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.code}`, "X-Motion-Session": run.id },
        body: JSON.stringify(command),
      };
      const response = await this.fetcher(MOTION_URL, options);
      if (response.status === 401) throw new BridgeError("Check the pairing code printed by the motion bridge in Terminal.");
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
        throw new BridgeError(typeof message === "string" && message.length <= 400 && !message.includes(run.code)
          ? message : "The local bridge rejected this request. Check its Terminal window and try again.");
      }
      if (!isReply(payload)) throw new BridgeError("The motion bridge sent an invalid reading. Restart the bridge from this checkout.");
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
