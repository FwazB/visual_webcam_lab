"use client";

// Developer panel for the audio chain and fusion: meters, note log,
// Δk histogram, thresholds, and test tones.

import { useEffect, useState } from "react";
import type { GuitarPitch } from "@/hooks/useGuitarPitch";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { midiToName } from "@/lib/instrument/pitch";
import type { FusionOutput } from "@/lib/instrument/fusion";
import type { StepView } from "@/lib/lesson/stepMachine";
import AudioDevicePicker from "./AudioDevicePicker";

interface PitchDebugPanelProps {
  pitch: GuitarPitch;
  profile: InstrumentProfile;
  getFusion: () => FusionOutput | null;
  getStep: () => StepView | null;
  neckK: number | null;
}

export default function PitchDebugPanel({ pitch, profile, getFusion, getStep, neckK }: PitchDebugPanelProps) {
  const [, setTick] = useState(0);
  const [sweepReport, setSweepReport] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 66);
    return () => window.clearInterval(id);
  }, []);

  const frame = pitch.frameRef.current;
  const note = pitch.activeNoteRef.current;
  const fusion = getFusion();
  const step = getStep();
  const log = pitch.noteLogRef.current.slice(-10).reverse();
  const onsetAgo = frame ? frame.t - pitch.lastOnsetRef.current : 999;
  const ctxRate = pitch.context?.sampleRate ?? 0;

  const runSweep = async (drive: number) => {
    if (!pitch.test) return;
    setSweepReport("sweeping…");
    const startLen = pitch.noteLogRef.current.length;
    const played = await pitch.test.sweep(profile.tuning[0], profile.tuning[profile.tuning.length - 1] + 12, { drive });
    await new Promise((r) => setTimeout(r, 400));
    const got = pitch.noteLogRef.current.slice(startLen);
    let octave = 0;
    let missing = 0;
    let worstCents = 0;
    for (const p of played) {
      const near = got.filter((n) => Math.abs(n.t - p.t) < 0.25);
      if (near.length === 0) {
        missing++;
        continue;
      }
      const n = near[0];
      if (Math.abs(n.midi - p.midi) === 12) octave++;
      else worstCents = Math.max(worstCents, Math.abs((n.midiFloat - p.midi) * 100));
    }
    setSweepReport(`${played.length} notes: ${octave} octave errors, ${missing} missing, ${got.length - played.length + missing} extra, worst |cents| ${worstCents.toFixed(1)}`);
  };

  const bar = (v: number, max: number, color: string, marker?: number) => (
    <div className="relative h-2 w-full bg-white/10 rounded">
      <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: color }} />
      {marker !== undefined && <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${(marker / max) * 100}%` }} />}
    </div>
  );

  return (
    <div className="text-[11px] font-mono bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg p-2 space-y-1.5 w-[320px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-zinc-400">audio: {pitch.status}</span>
        {pitch.status === "idle" || pitch.status === "needs-device" || pitch.status === "error" ? (
          <button onClick={() => pitch.start()} className="px-2 py-0.5 rounded bg-white text-black">Connect guitar</button>
        ) : (
          <button onClick={() => pitch.stop()} className="px-2 py-0.5 rounded bg-white/10">stop</button>
        )}
      </div>
      {pitch.error && <div className="text-red-400">{pitch.error}</div>}
      {(pitch.status === "needs-device" || pitch.devices.length > 1) && (
        <AudioDevicePicker devices={pitch.devices} selectedDeviceId={pitch.selectedDeviceId} onSelect={pitch.selectDevice} />
      )}
      {pitch.settings && (
        <div className="text-zinc-500 truncate">
          in {pitch.settings.sampleRate ?? "?"} Hz ch{pitch.settings.channelCount ?? "?"} ctx {ctxRate} Hz
          {pitch.settings.echoCancellation ? " EC!" : ""}{pitch.settings.noiseSuppression ? " NS!" : ""}{pitch.settings.autoGainControl ? " AGC!" : ""}
        </div>
      )}
      {frame && (
        <>
          <div className="flex justify-between">
            <span>{frame.hz > 0 ? `${frame.hz.toFixed(1)} Hz ${midiToName(frame.midi)} ${frame.cents >= 0 ? "+" : ""}${frame.cents.toFixed(0)}c` : "—"}</span>
            <span className={onsetAgo < 0.1 ? "text-yellow-300" : "text-zinc-600"}>● onset</span>
          </div>
          <div className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 items-center">
            <span className="text-zinc-500">clarity</span>
            {bar(frame.clarity, 1, "#4df", pitch.tuning.clarityThreshold)}
            <span className="text-zinc-500">level</span>
            {bar(frame.db + 80, 80, "#8f8", pitch.tuning.gateDb + 80)}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
        <label className="flex items-center gap-1">gate {pitch.tuning.gateDb}
          <input type="range" min={-70} max={-20} value={pitch.tuning.gateDb} onChange={(e) => pitch.setTuning({ gateDb: +e.target.value })} className="w-16" />
        </label>
        <label className="flex items-center gap-1">clar {pitch.tuning.clarityThreshold.toFixed(2)}
          <input type="range" min={0.5} max={0.98} step={0.01} value={pitch.tuning.clarityThreshold} onChange={(e) => pitch.setTuning({ clarityThreshold: +e.target.value })} className="w-16" />
        </label>
        <label className="flex items-center gap-1">k {pitch.tuning.k.toFixed(2)}
          <input type="range" min={0.7} max={1} step={0.01} value={pitch.tuning.k} onChange={(e) => pitch.setTuning({ k: +e.target.value })} className="w-16" />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={pitch.tuning.notch60} onChange={(e) => pitch.setTuning({ notch60: e.target.checked })} /> 60Hz notch
        </label>
      </div>
      {pitch.test && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-zinc-500">test</span>
          {profile.tuning.map((m, i) => (
            <button key={i} onClick={() => pitch.test?.playPluck(m)} className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20">{profile.stringLabels[i]}</button>
          ))}
          <button onClick={() => runSweep(0)} className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20">sweep</button>
          <button onClick={() => runSweep(0.6)} className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20">sweep+drive</button>
        </div>
      )}
      {sweepReport && <div className="text-zinc-300">{sweepReport}</div>}
      {note && (
        <div className="text-emerald-300">
          note #{note.id} {midiToName(note.midi)} {note.cents >= 0 ? "+" : ""}{note.cents.toFixed(0)}c conf {note.confidence.toFixed(2)} {note.kind}
        </div>
      )}
      {fusion && (
        <div className="space-y-1">
          <div className="flex justify-between">
            <span>fusion {fusion.verdict} {fusion.fusionConfidence.toFixed(2)}</span>
            <span>k {neckK ?? "—"}</span>
          </div>
          <div className="flex items-end gap-px h-6">
            {fusion.debug.histogram.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end">
                <div className="w-full" style={{ height: `${Math.min(100, (h / 3) * 100)}%`, background: i === 4 ? "#8f8" : "#fc4" }} />
                <span className="text-[9px] text-zinc-500">{i - 4}</span>
              </div>
            ))}
          </div>
          {fusion.lastConfirmed && (
            <div className="text-zinc-300">
              last: {profile.stringLabels[fusion.lastConfirmed.s]}|{fusion.lastConfirmed.f} {fusion.lastConfirmed.finger} cost {fusion.lastConfirmed.cost.toFixed(2)}
              {fusion.lastConfirmed.ambiguous ? " ambiguous" : ""}{fusion.lastConfirmed.unmatched ? " unmatched" : ""}
            </div>
          )}
          <div className="text-zinc-500">offsets {fusion.stringOffsets.map((o) => o.toFixed(2)).join(" ")}</div>
        </div>
      )}
      {step && <div className="text-zinc-300">step {step.phase} target#{step.targetIndex} done {step.completed}{step.hint ? ` · ${step.hint}` : ""}</div>}
      {log.length > 0 && (
        <div className="text-zinc-500 max-h-24 overflow-y-auto">
          {log.map((n) => (
            <div key={n.id}>#{n.id} {n.t.toFixed(3)}s {midiToName(n.midi)} {n.cents >= 0 ? "+" : ""}{n.cents.toFixed(0)}c {n.confidence.toFixed(2)} {n.kind}</div>
          ))}
        </div>
      )}
    </div>
  );
}
