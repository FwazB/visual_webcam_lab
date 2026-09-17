"use client";

import { useId, useState } from "react";
import type { TouchDesignerBridge } from "@/hooks/useTouchDesigner";

export default function TouchDesignerPanel({ bridge }: { bridge: TouchDesignerBridge }) {
  const [pairingCode, setPairingCode] = useState("");
  const pairingId = useId();
  const ready = bridge.status === "ready";
  const active = ready || bridge.status === "connecting" || bridge.status === "handshaking";
  const parameters = bridge.state?.parameters;
  const amount = typeof parameters?.["visual.fuzz.amount"] === "number" ? parameters["visual.fuzz.amount"] : 0;
  const feedback = typeof parameters?.["visual.fuzz.feedback"] === "number" ? parameters["visual.fuzz.feedback"] : 0;
  const blackout = parameters?.["output.blackout"] === true;
  const labels = {
    disconnected: "Disconnected", connecting: "Connecting…", handshaking: "Pairing…", ready: "Connected", error: "Disconnected",
  } as const;

  return (
    <details className="rounded-lg border border-white/10 bg-black/65 p-3 text-xs text-white backdrop-blur-sm">
      <summary className="cursor-pointer select-none font-medium">
        TouchDesigner visuals <span className={ready ? "ml-2 text-emerald-300" : "ml-2 text-zinc-400"}>{labels[bridge.status]}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-sm text-zinc-400">Open Fuzz in TouchDesigner on this computer. Pair to send chord changes and note pulses; camera and audio stay in the trainer.</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (active) return;
          bridge.connect(pairingCode.trim());
          setPairingCode("");
        }}>
          {!active && <label htmlFor={pairingId} className="flex flex-col gap-1 text-zinc-300">
            Pairing code
            <input id={pairingId} type="password" autoComplete="off" spellCheck={false} maxLength={128}
              value={pairingCode} onChange={(event) => setPairingCode(event.target.value)}
              placeholder="From TouchDesigner" className="w-48 rounded border border-white/15 bg-black/60 px-2 py-1.5 text-white" />
          </label>}
          {active ? <button type="button" onClick={bridge.disconnect} className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20">Disconnect</button>
            : <button type="submit" disabled={pairingCode.trim().length < 8} className="rounded bg-white px-3 py-1.5 text-black disabled:opacity-40">{bridge.status === "error" ? "Reconnect" : "Connect"}</button>}
        </form>
        <p role="status" aria-live="polite" className={bridge.error ? "max-w-sm text-amber-300" : "text-zinc-400"}>
          {bridge.error ?? (ready ? "Fuzz is ready. Its controls below reflect the engine state." : "Connect when you want local visuals.")}
        </p>
        <fieldset disabled={!ready} className="space-y-2 disabled:opacity-40">
          <legend className="sr-only">Fuzz controls</legend>
          <label className="flex items-center gap-3">
            <span className="w-20">Warp amount</span>
            <input type="range" min={0} max={1} step={0.01} value={amount}
              onChange={(event) => bridge.setParameter("visual.fuzz.amount", Number(event.target.value))} className="w-32 accent-emerald-300" />
            <output className="w-8 text-right tabular-nums">{ready ? amount.toFixed(2) : "—"}</output>
          </label>
          <label className="flex items-center gap-3">
            <span className="w-20">Trails</span>
            <input type="range" min={0} max={0.98} step={0.01} value={feedback}
              onChange={(event) => bridge.setParameter("visual.fuzz.feedback", Number(event.target.value))} className="w-32 accent-emerald-300" />
            <output className="w-8 text-right tabular-nums">{ready ? feedback.toFixed(2) : "—"}</output>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={blackout} onChange={(event) => bridge.setParameter("output.blackout", event.target.checked)} className="accent-emerald-300" />
            Blackout
          </label>
        </fieldset>
      </div>
    </details>
  );
}
