"use client";

// Fretboard trainer: lessons and song practice scored from the guitar's
// pitch and shown on a fretboard diagram. The camera is a mirror with
// fingertip dots from hand tracking.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FINGERTIPS, useHandTracking } from "@/hooks/useHandTracking";
import { useGuitarPitch } from "@/hooks/useGuitarPitch";
import { useSongTransport } from "@/hooks/useSongTransport";
import { useTouchDesigner } from "@/hooks/useTouchDesigner";
import AudioDevicePicker from "@/components/AudioDevicePicker";
import PitchDebugPanel from "@/components/PitchDebugPanel";
import TouchDesignerPanel from "@/components/TouchDesignerPanel";
import { midiToName, NOTE_NAMES, pitchClassOf } from "@/lib/instrument/pitch";
import { midiAt, type InstrumentProfile } from "@/lib/instrument/profile";
import { nearestPosition, type FretPosition } from "@/lib/instrument/positions";
import { drawFretboard, type DiagramTarget, type PlayedPulse } from "@/lib/lesson/drawFretboard";
import { KEYS, SHAPES, resolveShape, type MatchState } from "@/lib/lesson/shapes";
import { chartPositionAt, SongScorer, voicingFor, type SongScoreSummary } from "@/lib/lesson/songPlayer";
import { SONGS, withBarsPerChord, type FingerName, type SongChart } from "@/lib/lesson/songs";
import { StepMachine, type StepView } from "@/lib/lesson/stepMachine";

const FINGERTIP_COLORS = ["#00FF88", "#00DDFF", "#FF88DD", "#FFCC00"];

const TRAFFIC_COLORS: Record<MatchState, string> = {
  green: "#22dd55",
  yellow: "#ffcc00",
  red: "#ff4455",
};

const DIM_COLOR = "#888866";

const FINGER_INITIAL: Record<FingerName, string> = { index: "1", middle: "2", ring: "3", pinky: "4" };

const NAV_ROUTES = [
  { id: "guitar-standard", href: "/guitar", label: "Guitar" },
  { id: "bass-standard", href: "/bass", label: "Bass" },
  { id: "studio", href: "/studio", label: "Studio" },
  { id: "for-you", href: "/for-you", label: "For you" },
];

interface Target extends FretPosition {
  midi: number;
  label: string;
}

/** A chord's voicing as targets in practice (arpeggio) order. */
function chordTargets(chart: SongChart, profile: InstrumentProfile, chordId: string): Target[] {
  const v = voicingFor(chart, profile, chordId);
  if (!v) return [];
  const order = v.arpeggio ?? v.notes.map((_, i) => i);
  return order.map((i) => {
    const n = v.notes[i];
    return { string: n.s, fret: n.f, midi: midiAt(profile, n.s, n.f), label: n.finger ? FINGER_INITIAL[n.finger] : "" };
  });
}

function sizeCanvas(canvas: HTMLCanvasElement | null, container: HTMLDivElement | null) {
  if (!canvas || !container) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return null;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

interface FretLabProps {
  profile: InstrumentProfile;
}

export default function FretLab({ profile }: FretLabProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const boardCanvasRef = useRef<HTMLCanvasElement>(null);
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [shapeId, setShapeId] = useState(SHAPES[0].id);
  const [keyName, setKeyName] = useState<(typeof KEYS)[number]>("A");
  const [matchState, setMatchState] = useState<MatchState>("yellow");
  // Rendered client-only (dynamic import with ssr: false), so window exists.
  const [debug] = useState(() => new URLSearchParams(window.location.search).get("debug") === "1");
  const [mode, setMode] = useState<"shapes" | "song">(() => new URLSearchParams(window.location.search).get("song") === SONGS[0].id ? "song" : "shapes");
  const [barsPerChord, setBarsPerChord] = useState<1 | 2>(1);
  const song = SONGS[0];
  const chart = useMemo(() => withBarsPerChord(song, barsPerChord), [song, barsPerChord]);
  const [songSummary, setSongSummary] = useState<SongScoreSummary | null>(null);
  const [songChord, setSongChord] = useState<{ current: string; next: string; barIndex: number; beatInBar: number }>({
    current: song.sections[0].loop[0].chordId,
    next: song.sections[0].loop[1]?.chordId ?? song.sections[0].loop[0].chordId,
    barIndex: 0,
    beatInBar: 0,
  });
  const songChordIndexRef = useRef(0);
  const scorerRef = useRef<SongScorer | null>(null);
  const lastSongNoteRef = useRef<{ chordTone: boolean; at: number } | null>(null);

  const { handsRef, isLoading: handsLoading, error: handsError } = useHandTracking(videoRef);
  const pitch = useGuitarPitch(profile);
  const transport = useSongTransport(chart, pitch.context);
  const touchDesigner = useTouchDesigner();
  const { sendChord, sendNoteHit, setPlaying: setVisualPlaying } = touchDesigner;
  const activeSongChordId = songChord.current;
  useEffect(() => {
    if (touchDesigner.status !== "ready") return;
    setVisualPlaying(mode === "song" && transport.playing);
  }, [touchDesigner.status, mode, transport.playing, setVisualPlaying]);
  useEffect(() => {
    if (touchDesigner.status !== "ready" || mode !== "song") return;
    if (activeSongChordId === "c9sus4" || activeSongChordId === "dm7" || activeSongChordId === "gm") {
      sendChord(activeSongChordId);
    }
  }, [touchDesigner.status, mode, activeSongChordId, sendChord]);
  if (!scorerRef.current) scorerRef.current = new SongScorer(chart, profile);
  useEffect(() => {
    scorerRef.current?.reset(chart);
    setSongSummary(null);
  }, [chart]);
  const stepRef = useRef<StepMachine | null>(null);
  if (!stepRef.current) stepRef.current = new StepMachine();
  const stepViewRef = useRef<StepView | null>(null);
  const pulseRef = useRef<PlayedPulse | null>(null);
  const lastPlayedRef = useRef<FretPosition | null>(null);
  const audioRunning = pitch.status === "running";
  const transportRef = useRef(transport);
  const chartRef = useRef(chart);
  const modeRef = useRef(mode);
  const audioRunningRef = useRef(audioRunning);
  useEffect(() => {
    transportRef.current = transport;
    chartRef.current = chart;
    modeRef.current = mode;
    audioRunningRef.current = audioRunning;
  });

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId) ?? SHAPES[0], [shapeId]);
  const shapeTargets = useMemo<Target[]>(
    () =>
      resolveShape(shape, NOTE_NAMES.indexOf(keyName), profile).map((p) => ({
        string: p.string,
        fret: p.fret,
        midi: p.midi,
        label: p.role,
      })),
    [shape, keyName, profile],
  );
  const targetsRef = useRef<Target[]>(shapeTargets);
  const stepKeyRef = useRef("");

  // Shapes mode: the lesson step follows the selected shape.
  useEffect(() => {
    if (mode !== "shapes") return;
    targetsRef.current = shapeTargets;
    const step = stepRef.current!;
    step.setStep({ targets: shapeTargets, mode: shapeTargets.length > 1 ? "sequence" : "single" });
    step.setOnAdvance(null);
    stepKeyRef.current = "";
  }, [shapeTargets, mode]);

  function startSong() {
    scorerRef.current?.reset(chart);
    setSongSummary(null);
    lastSongNoteRef.current = null;
    setTransportError(null);
    transport.start().catch(() => setTransportError("Audio could not start. Reconnect the guitar, then press Play again."));
  }

  // Note events → lesson or song scoring → diagram pulse and visuals.
  useEffect(() => {
    return pitch.onNote((evt) => {
      let ok: boolean;
      if (modeRef.current === "song" && transportRef.current.playing) {
        const noteBeat = transportRef.current.beatsAt(evt.t);
        // Count-in notes must not score against the first chord.
        if (noteBeat < 0) return;
        const res = scorerRef.current!.onNote(evt, chartPositionAt(chartRef.current, noteBeat));
        lastSongNoteRef.current = { chordTone: res.chordTone, at: performance.now() };
        ok = res.chordTone;
      } else {
        ok = stepRef.current!.onNote(evt);
      }
      sendNoteHit(ok, evt.strength);
      // Place the note on the diagram: a matching target, else the position
      // nearest the current target or the previous note.
      const targets = targetsRef.current;
      const current = targets[stepViewRef.current?.targetIndex ?? 0] ?? null;
      const played = targets.find((t) => t.midi === evt.midi)
        ?? nearestPosition(profile, evt.midi, current ?? lastPlayedRef.current);
      if (!played) return;
      lastPlayedRef.current = { string: played.string, fret: played.fret };
      pulseRef.current = { string: played.string, fret: played.fret, ok, at: performance.now() };
    });
  }, [pitch, profile, sendNoteHit]);

  // Camera mirror.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 960, height: 540, facingMode: "user" }, audio: false })
      .then((granted) => {
        if (cancelled) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        video.srcObject = granted;
        video.onloadeddata = () => setWebcamReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setCameraError(err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission is blocked. Allow it in site settings to see yourself; audio practice still works."
          : "Camera unavailable. Audio practice and the fretboard still work.");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  // Render loop: song clock, step timers, traffic light, camera dots, diagram.
  useEffect(() => {
    let rafId = 0;
    let lastMatch: MatchState = "yellow";
    let matchFrameCounter = 0;
    let lastFrameMs = 0;
    let frameCounter = 0;
    const FRAME_INTERVAL_MS = 1000 / 30;

    function updateSong(): Set<number> | null {
      const ch = chartRef.current;
      const tr = transportRef.current;
      const loop = ch.sections[0].loop;
      let chordId: string;
      let nextId: string;
      let barIndex: number;
      let beatInBar = 0;
      let covered: Set<number> | null = null;
      if (tr.playing) {
        const pos = chartPositionAt(ch, tr.beatsRef.current);
        chordId = pos.chordId;
        nextId = pos.nextChordId;
        barIndex = pos.barIndex;
        beatInBar = pos.beatInBar;
        const scorer = scorerRef.current!;
        if (tr.beatsRef.current >= 0) scorer.tick(pos);
        const cur = scorer.summary().current;
        if (cur) {
          covered = new Set<number>();
          targetsRef.current.forEach((t, i) => {
            if (cur.tonesHit.has(pitchClassOf(t.midi))) covered!.add(i);
          });
        }
        if (frameCounter % 10 === 0) setSongSummary(scorer.summary());
      } else {
        barIndex = songChordIndexRef.current % loop.length;
        chordId = loop[barIndex].chordId;
        nextId = loop[(barIndex + 1) % loop.length].chordId;
      }
      const key = `${chordId}|${tr.playing ? "play" : "free"}`;
      if (stepKeyRef.current !== key) {
        stepKeyRef.current = key;
        const targets = chordTargets(ch, profile, chordId);
        targetsRef.current = targets;
        const step = stepRef.current!;
        if (tr.playing) {
          step.setStep({ targets: [], mode: "single" });
          step.setOnAdvance(null);
        } else {
          // Free practice steps through the loop's chords.
          step.setStep({ targets, mode: "sequence" });
          step.setOnAdvance(() => {
            songChordIndexRef.current = (songChordIndexRef.current + 1) % loop.length;
          });
        }
      }
      if (frameCounter % 6 === 0) {
        const bib = Math.floor(beatInBar);
        setSongChord((prev) =>
          prev.current === chordId && prev.next === nextId && prev.barIndex === barIndex && prev.beatInBar === bib
            ? prev
            : { current: chordId, next: nextId, barIndex, beatInBar: bib },
        );
      }
      return covered;
    }

    function drawCamera(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.clearRect(0, 0, w, h);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      // The video is shown with object-cover and mirrored.
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const ox = (w - video.videoWidth * scale) / 2;
      const oy = (h - video.videoHeight * scale) / 2;
      for (const hand of handsRef.current) {
        FINGERTIPS.forEach((index, i) => {
          const lm = hand.landmarks[index];
          if (!lm) return;
          const x = w - (lm.x * video.videoWidth * scale + ox);
          const y = lm.y * video.videoHeight * scale + oy;
          ctx.strokeStyle = FINGERTIP_COLORS[i];
          ctx.fillStyle = FINGERTIP_COLORS[i];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    function tick(nowMs: number) {
      rafId = requestAnimationFrame(tick);
      if (nowMs - lastFrameMs < FRAME_INTERVAL_MS) return;
      lastFrameMs = nowMs;
      const nowPerf = performance.now();
      const songMode = modeRef.current === "song";
      const songCovered = songMode ? updateSong() : null;
      frameCounter++;

      const tAudio = pitch.context ? pitch.context.currentTime : nowPerf / 1000;
      const view = stepRef.current!.onFrame(tAudio);
      stepViewRef.current = view;
      let light: MatchState = view.light;
      if (songMode && transportRef.current.playing) {
        const last = lastSongNoteRef.current;
        light = last && nowPerf - last.at < 400 ? (last.chordTone ? "green" : "red") : "yellow";
      }
      if (light !== lastMatch) {
        matchFrameCounter++;
        if (matchFrameCounter >= 3) {
          lastMatch = light;
          matchFrameCounter = 0;
          setMatchState(light);
        }
      } else {
        matchFrameCounter = 0;
      }

      // Song playback colours chord tones already played; lessons colour the
      // targets done so far and dim the ones still ahead.
      const playingSong = songMode && transportRef.current.playing;
      const stepping = audioRunningRef.current && !playingSong;
      const targets: DiagramTarget[] = targetsRef.current.map((t, i) => {
        const done = playingSong
          ? !!songCovered?.has(i)
          : stepping && (i < view.targetIndex || (i === view.targetIndex && view.phase === "hit"));
        const ahead = stepping && i > view.targetIndex;
        return {
          string: t.string,
          fret: t.fret,
          label: t.label,
          color: done ? TRAFFIC_COLORS.green : ahead ? DIM_COLOR : TRAFFIC_COLORS.yellow,
        };
      });

      const camera = sizeCanvas(cameraCanvasRef.current, cameraContainerRef.current);
      if (camera) drawCamera(camera.ctx, camera.w, camera.h);
      const board = sizeCanvas(boardCanvasRef.current, boardContainerRef.current);
      if (board) drawFretboard(board.ctx, board.w, board.h, profile, targets, pulseRef.current);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [handsRef, profile, pitch.context]);

  const status = cameraError
    ? "Audio practice · camera unavailable"
    : handsError
      ? "Hand tracking unavailable · audio practice available"
      : !webcamReady
        ? "Starting video..."
        : handsLoading
          ? "Loading hand tracking..."
          : mode === "song"
            ? `${song.title} · ${song.key}`
            : `${keyName} ${shape.name}`;
  const currentVoicing = voicingFor(chart, profile, songChord.current);
  const nextVoicing = voicingFor(chart, profile, songChord.next);
  const loopBars = chart.sections[0].loop;
  const selectedDeviceLabel = pitch.devices.find((d) => d.deviceId === pitch.selectedDeviceId)?.label ?? "";

  return (
    <div className="fixed inset-0 bg-black text-white overflow-y-auto flex flex-col">
      <div className="relative z-10 p-3 sm:p-4 flex items-start justify-between flex-shrink-0 gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight"><Link href="/" className="hover:text-zinc-300">{profile.name.toLowerCase()}.lab</Link></h1>
          <p className="text-zinc-400 text-xs truncate">{status}</p>
        </div>
        <div className="flex items-center gap-2">
          {pitch.status === "running" ? (
            <span
              className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 max-w-[220px] truncate"
              title={selectedDeviceLabel}
            >
              guitar in · {selectedDeviceLabel.replace(/\s*\(.*\)\s*$/, "") || "input"}
            </span>
          ) : pitch.status === "starting" ? (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-zinc-300">connecting…</span>
          ) : pitch.status === "suspended" ? (
            <button onClick={() => pitch.context?.resume()} className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-yellow-400 text-black">
              click to enable audio
            </button>
          ) : (
            <button onClick={() => pitch.start()} className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-white text-black active:scale-95">
              Connect guitar
            </button>
          )}
          {pitch.status === "needs-device" && (
            <>
              <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">Spark not detected: check USB-C and power, then pick it →</span>
              <AudioDevicePicker devices={pitch.devices} selectedDeviceId={pitch.selectedDeviceId} onSelect={pitch.selectDevice} />
            </>
          )}
          {pitch.error && pitch.status === "error" && (
            <span className="text-[11px] font-mono text-red-300 max-w-[240px] truncate" title={pitch.error}>
              {/NotAllowed|Permission/i.test(pitch.error) ? "microphone blocked: allow it in the browser's site settings" : pitch.error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
          {(["red", "yellow", "green"] as MatchState[]).map((s) => (
            <div
              key={s}
              className="w-3 h-3 rounded-full transition-all"
              style={{
                backgroundColor: matchState === s ? TRAFFIC_COLORS[s] : "#222",
                boxShadow: matchState === s ? `0 0 12px ${TRAFFIC_COLORS[s]}` : "none",
              }}
            />
          ))}
        </div>
        <nav className="flex gap-1 flex-shrink-0">
          {NAV_ROUTES.map((r) => (
            <Link
              key={r.id}
              href={r.href}
              className={`text-xs px-3 py-1.5 rounded-full border border-white/10 transition active:scale-95 ${
                profile.id === r.id ? "bg-white text-black" : "bg-white/10 text-zinc-400 hover:text-white"
              }`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      <div ref={cameraContainerRef} className="relative flex-1 min-h-[200px]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas ref={cameraCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {handsError && (
          <p role="status" className="absolute top-3 right-3 max-w-xs rounded border border-amber-200/20 bg-black/80 px-2 py-1 text-xs text-amber-200">
            {handsError}
          </p>
        )}

        {debug && (
          <div className="absolute top-3 left-3">
            <PitchDebugPanel pitch={pitch} profile={profile} getStep={() => stepViewRef.current} />
          </div>
        )}
        <div className="absolute bottom-3 left-3 max-w-md bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
          {mode === "song" ? (
            <>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Song</div>
              <div className="text-sm font-medium">
                {song.title} <span className="text-zinc-400">· {song.artist}</span>
              </div>
              <div className="text-xs text-zinc-300 mt-0.5">
                now <span className="text-yellow-300 font-semibold">{currentVoicing?.name ?? songChord.current}</span>
                {" → "}next <span className="text-zinc-400">{nextVoicing?.name ?? songChord.next}</span>
                {transport.playing && (
                  <span className="ml-2 text-zinc-500">
                    {Array.from({ length: chart.beatsPerBar }, (_, b) => (b <= songChord.beatInBar ? "●" : "○")).join(" ")}
                  </span>
                )}
              </div>
              {!transport.playing && <div className="text-xs text-zinc-500 mt-0.5">{song.notes}</div>}
            </>
          ) : (
            <>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Lesson</div>
              <div className="text-sm font-medium">
                {keyName} {shape.name}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">{shape.description}</div>
            </>
          )}
        </div>
      </div>

      <div className="bg-zinc-950/95 border-t border-white/10 flex-shrink-0">
        {cameraError && <p role="status" className="px-3 pt-2 text-xs text-amber-200">{cameraError}</p>}
        <div ref={boardContainerRef} className="relative h-44 sm:h-56">
          <canvas ref={boardCanvasRef} className="absolute inset-0 w-full h-full" />
        </div>
        <div className="border-t border-white/5 px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["shapes", "song"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (m === "shapes" && transport.playing) transport.stop();
                  setMode(m);
                }}
                className={`text-[11px] font-mono px-2.5 py-1.5 rounded transition active:scale-95 ${
                  mode === m ? "bg-emerald-400 text-black" : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {m === "shapes" ? "Shapes" : `Song: ${song.title}`}
              </button>
            ))}
            {!audioRunning && <span className="text-[11px] font-mono text-zinc-500">connect the guitar to score notes</span>}
          </div>
          {mode === "song" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {loopBars.map((bar, i) => {
                  const v = voicingFor(chart, profile, bar.chordId);
                  const active = songChord.barIndex === i;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (!transport.playing) songChordIndexRef.current = i;
                      }}
                      className={`text-[12px] font-mono px-3 py-1.5 rounded border transition ${
                        active ? "bg-yellow-400 text-black border-yellow-300" : "bg-white/5 text-zinc-200 border-white/10 hover:bg-white/15"
                      }`}
                    >
                      {v?.name ?? bar.chordId}
                      <span className="opacity-60"> · {bar.beats / chart.beatsPerBar}b</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <button
                  onClick={() => (transport.playing ? transport.stop() : startSong())}
                  className={`px-3 py-1.5 rounded font-semibold ${transport.playing ? "bg-red-400 text-black" : "bg-white text-black"}`}
                >
                  {transport.playing ? "■ Stop" : "▶ Play"}
                </button>
                <span className="flex items-center gap-1">
                  <button onClick={() => transport.setBpm(transport.bpm - 2)} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">−</button>
                  <input
                    type="number"
                    value={transport.bpm}
                    onChange={(e) => transport.setBpm(Number(e.target.value))}
                    className="w-14 bg-black/40 border border-white/10 rounded px-1 py-1 text-center"
                  />
                  <button onClick={() => transport.setBpm(transport.bpm + 2)} className="px-2 py-1 rounded bg-white/10 hover:bg-white/20">+</button>
                  <span className="text-zinc-500">bpm</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-zinc-500">bars/chord</span>
                  {([1, 2] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        if (transport.playing) transport.stop();
                        setBarsPerChord(n);
                      }}
                      className={`px-2 py-1 rounded ${barsPerChord === n ? "bg-white text-black" : "bg-white/10 hover:bg-white/20"}`}
                    >
                      {n}
                    </button>
                  ))}
                </span>
                <label className="flex items-center gap-1 text-zinc-300">
                  <input type="checkbox" checked={transport.metronome} onChange={(e) => transport.setMetronome(e.target.checked)} /> click
                </label>
                <label className="flex items-center gap-1 text-zinc-300">
                  <input type="checkbox" checked={transport.backing} onChange={(e) => transport.setBacking(e.target.checked)} /> backing
                </label>
                {songSummary && songSummary.slotsPlayed > 0 && (
                  <span className="text-zinc-300">
                    accuracy <span className="text-white">{Math.round(songSummary.accuracy * 100)}%</span> · streak{" "}
                    <span className="text-white">{songSummary.streak}</span> (best {songSummary.bestStreak}) · wrong{" "}
                    <span className="text-white">{songSummary.wrongNotes}</span>
                  </span>
                )}
                {audioRunning && <span className="text-zinc-500">pick chord notes one at a time · pedal looper off</span>}
                {transportError && <span role="alert" className="text-red-300">{transportError}</span>}
              </div>
              {currentVoicing && (
                <div className="text-[11px] font-mono text-zinc-400">
                  {currentVoicing.name}:{" "}
                  {currentVoicing.notes
                    .map((n) => `${profile.stringLabels[n.s]}${n.f}${n.finger ? "(" + FINGER_INITIAL[n.finger] + ")" : ""} ${midiToName(midiAt(profile, n.s, n.f))}`)
                    .join("  ")}
                </div>
              )}
            </div>
          )}
          {mode === "shapes" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setShapeId(s.id)}
                    className={`text-[11px] font-mono px-2.5 py-1.5 rounded transition active:scale-95 ${
                      shapeId === s.id ? "bg-white text-black" : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKeyName(k)}
                    className={`text-[11px] font-mono w-8 h-7 rounded transition active:scale-95 ${
                      keyName === k ? "bg-yellow-400 text-black" : "bg-white/5 hover:bg-white/15 text-zinc-300"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </>
          )}
          <TouchDesignerPanel bridge={touchDesigner} />
        </div>
      </div>
    </div>
  );
}
