"use client";

import type { AudioParams, EffectLocks, EffectType, HandTargets } from "@/hooks/useAudioEngine";

interface ParamDisplayProps {
  audioParams: AudioParams;
  isPlaying: boolean;
  locks: EffectLocks;
  handTargets: HandTargets;
}

const EFFECT_COLORS: Record<EffectType, string> = {
  speed: "#00FF88",
  delay: "#FF8800",
  pan: "#AA66FF",
};

function handLabel(
  effect: EffectType,
  targets: HandTargets
): string | null {
  if (targets.left === effect && targets.right === effect) return "L+R";
  if (targets.left === effect) return "L";
  if (targets.right === effect) return "R";
  return null;
}

function ParamBar({
  label,
  value,
  max,
  unit,
  color,
  locked,
  hand,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
  locked: boolean;
  hand: string | null;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-20 flex items-center justify-end gap-1.5">
        {locked && (
          <span className="text-yellow-400 text-[10px]" title="Locked">
            &#x1f512;
          </span>
        )}
        <span className="text-zinc-400 font-mono text-xs">{label}</span>
      </div>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            opacity: locked ? 0.5 : 1,
          }}
        />
        {locked && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(234,179,8,0.15) 3px, rgba(234,179,8,0.15) 6px)`,
            }}
          />
        )}
      </div>
      <span className="w-16 text-zinc-500 font-mono text-xs">
        {typeof value === "number" ? value.toFixed(2) : value}
        {unit}
      </span>
      <span className="w-6 text-[10px] font-bold" style={{ color: hand ? color : "transparent" }}>
        {hand ?? "·"}
      </span>
    </div>
  );
}

export default function ParamDisplay({
  audioParams,
  isPlaying,
  locks,
  handTargets,
}: ParamDisplayProps) {
  if (!isPlaying) return null;

  const anyLocked = locks.speed.locked || locks.delay.locked || locks.pan.locked;
  const allLocked = locks.speed.locked && locks.delay.locked && locks.pan.locked;

  return (
    <div
      className={`absolute bottom-6 left-6 bg-black/70 backdrop-blur-md rounded-xl p-4 space-y-2 w-80 border ${
        anyLocked ? "border-yellow-500/40" : "border-zinc-800"
      }`}
    >
      <div className="text-xs uppercase tracking-wider mb-3 font-semibold flex items-center justify-between">
        <span className={anyLocked ? "text-yellow-400" : "text-zinc-500"}>
          Hand Controls
        </span>
        {allLocked && (
          <span className="text-yellow-400 text-[10px] bg-yellow-400/10 px-2 py-0.5 rounded-full">
            ALL LOCKED
          </span>
        )}
      </div>

      <ParamBar
        label="Speed"
        value={audioParams.playbackRate}
        max={2.0}
        unit="x"
        color={EFFECT_COLORS.speed}
        locked={locks.speed.locked}
        hand={handLabel("speed", handTargets)}
      />
      <ParamBar
        label="Delay"
        value={audioParams.delayWet}
        max={0.6}
        unit=""
        color={EFFECT_COLORS.delay}
        locked={locks.delay.locked}
        hand={handLabel("delay", handTargets)}
      />
      <ParamBar
        label="Pan"
        value={(audioParams.pan + 1) / 2}
        max={1.0}
        unit={audioParams.pan < -0.1 ? " L" : audioParams.pan > 0.1 ? " R" : ""}
        color={EFFECT_COLORS.pan}
        locked={locks.pan.locked}
        hand={handLabel("pan", handTargets)}
      />

      <div className="text-[10px] text-zinc-600 mt-2 space-y-0.5">
        {!anyLocked ? (
          <>
            <p>
              <span className="text-[#00FF88]">L hand</span> pinch &rarr; speed
            </p>
            <p>
              <span className="text-[#FF8800]">R hand</span> pinch &rarr; delay
            </p>
            <p>
              <span className="text-[#AA66FF]">Hand position</span> &rarr; pan
            </p>
            <p className="mt-1">
              <span className="text-yellow-400">Throw hand up</span> &rarr; lock
              effect
            </p>
          </>
        ) : allLocked ? (
          <p>
            <span className="text-yellow-400">Throw hand up</span> &rarr; unlock
            all
          </p>
        ) : (
          <>
            {handTargets.left && (
              <p>
                <span style={{ color: EFFECT_COLORS[handTargets.left] }}>
                  L hand
                </span>{" "}
                &rarr; {handTargets.left}
                {handTargets.left !== "pan" ? " (pinch)" : " (position)"}
              </p>
            )}
            {handTargets.right && (
              <p>
                <span style={{ color: EFFECT_COLORS[handTargets.right] }}>
                  R hand
                </span>{" "}
                &rarr; {handTargets.right}
                {handTargets.right !== "pan" ? " (pinch)" : " (position)"}
              </p>
            )}
            <p className="mt-1">
              <span className="text-yellow-400">Throw up</span> &rarr; lock
              &nbsp;|&nbsp;
              <span className="text-pink-400">Pinky tap</span> &rarr; switch effect
            </p>
          </>
        )}
      </div>
    </div>
  );
}
