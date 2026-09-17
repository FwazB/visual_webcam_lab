"use client";

// Fretboard trainer: webcam + hand tracking + automatic neck detection.
// Targets are drawn on the real neck and on a static fretboard panel.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePoseTracking } from "@/hooks/usePoseTracking";
import { useNeckDetector } from "@/hooks/useNeckDetector";
import { useGuitarPitch } from "@/hooks/useGuitarPitch";
import { NeckFusion, type FingertipInput, type FusionOutput, type NeckFrame } from "@/lib/instrument/fusion";
import { StepMachine, type StepView } from "@/lib/lesson/stepMachine";
import PitchDebugPanel from "@/components/PitchDebugPanel";
import type { InstrumentProfile } from "@/lib/instrument/profile";
import { NOTE_NAMES } from "@/lib/instrument/pitch";
import { noteAt } from "@/lib/instrument/positions";
import { drawNeckOverlay } from "@/lib/neck/drawNeckOverlay";
import { FINGERTIP_INDEX, selectFrettingHand, type FingerName } from "@/lib/neck/fretHand";
import { getCoverTransform, pixelToNeck } from "@/lib/neck/model";
import type { NeckPosition } from "@/lib/neck/types";
import { KEYS, SHAPES, resolveShape, type MatchState } from "@/lib/bass/shapes";
import { SONGS, withBarsPerChord } from "@/lib/lesson/songs";
import { chartPositionAt, SongScorer, voicingFor, type SongScoreSummary } from "@/lib/lesson/songPlayer";
import { useSongTransport } from "@/hooks/useSongTransport";
import { midiAt } from "@/lib/instrument/profile";
import { midiToName, pitchClassOf } from "@/lib/instrument/pitch";
import type { HandDetection } from "@/hooks/usePoseTracking";
import { renderSyntheticNeck } from "@/lib/neck/dev/synthetic";

const FINGERTIP_COLORS: Record<FingerName, string> = {
  index: "#00FF88",
  middle: "#00DDFF",
  ring: "#FF88DD",
  pinky: "#FFCC00",
};

const TRAFFIC_COLORS: Record<MatchState, string> = {
  green: "#22dd55",
  yellow: "#ffcc00",
  red: "#ff4455",
};

const PANEL_FRETS = 15;

interface Target {
  string: number;
  fret: number;
  midi: number;
  label: string;
}

const FINGER_INITIAL: Record<FingerName, string> = { index: "1", middle: "2", ring: "3", pinky: "4" };

/** Only same-origin relative paths are accepted for the dev clip source. */
function safeClipSource(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  return value;
}

interface FretLabProps {
  profile: InstrumentProfile;
}

export default function FretLab({ profile }: FretLabProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const fretboardCanvasRef = useRef<HTMLCanvasElement>(null);
  const fretboardContainerRef = useRef<HTMLDivElement>(null);
  const [webcamReady, setWebcamReady] = useState(false);
  const [shapeId, setShapeId] = useState(SHAPES[0].id);
  const [keyName, setKeyName] = useState<(typeof KEYS)[number]>("A");
  const [matchState, setMatchState] = useState<MatchState>("red");
  const [debug, setDebug] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("webcam");
  const [swapHands, setSwapHands] = useState(false);
  const [mode, setMode] = useState<"shapes" | "song">("shapes");
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
  const songCoveredRef = useRef<Set<number> | null>(null);

  const syntheticHandsRef = useRef<HandDetection[] | null>(null);
  const { poseDataRef, isLoading: handsLoading } = usePoseTracking(videoRef);
  const neck = useNeckDetector(videoRef, {
    profile,
    getHands: () => syntheticHandsRef.current ?? poseDataRef.current?.hands ?? [],
    enabled: !paused,
    swapHands,
  });

  const fingerPositionsRef = useRef<Partial<Record<FingerName, NeckPosition>>>({});
  const pitch = useGuitarPitch(profile);
  const transport = useSongTransport(chart, pitch.context);
  if (!scorerRef.current) scorerRef.current = new SongScorer(chart, profile);
  useEffect(() => {
    scorerRef.current?.reset(chart);
    setSongSummary(null);
  }, [chart]);
  const fusionRef = useRef<NeckFusion | null>(null);
  if (!fusionRef.current) fusionRef.current = new NeckFusion(profile);
  const stepRef = useRef<StepMachine | null>(null);
  if (!stepRef.current) stepRef.current = new StepMachine();
  const fusionOutRef = useRef<FusionOutput | null>(null);
  const stepViewRef = useRef<StepView | null>(null);
  const tipsRef = useRef<FingertipInput[]>([]);
  const tipHistoryRef = useRef<Partial<Record<FingerName, { u: number; v: number; since: number }>>>({});
  const neckFrameRef = useRef<NeckFrame | null>(null);
  const pulseRef = useRef<{ s: number; f: number; ok: boolean; at: number } | null>(null);
  const audioRunning = pitch.status === "running";
  const transportRef = useRef(transport);
  const chartRef = useRef(chart);
  useEffect(() => {
    transportRef.current = transport;
    chartRef.current = chart;
  });

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId) ?? SHAPES[0], [shapeId]);
  const rootPc = NOTE_NAMES.indexOf(keyName);
  const shapeTargets = useMemo<Target[]>(
    () => resolveShape(shape, rootPc, profile).map((p) => ({ string: p.string, fret: p.fret, midi: p.midi, label: p.role })),
    [shape, rootPc, profile],
  );
  const targetsRef = useRef<Target[]>(shapeTargets);
  const stepKeyRef = useRef("");
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  });

  // Shapes mode: the lesson step follows the selected shape.
  useEffect(() => {
    if (mode !== "shapes") return;
    targetsRef.current = shapeTargets;
    const step = stepRef.current!;
    const lessonTargets = shapeTargets.map((t) => ({ s: t.string, f: t.fret, midi: t.midi, role: t.label }));
    step.setStep({
      targets: lessonTargets,
      mode: audioRunning ? (lessonTargets.length > 1 ? "sequence" : "single") : "shape-vision",
    });
    step.setOnAdvance(null);
    stepKeyRef.current = "";
  }, [shapeTargets, audioRunning, mode]);

  /** Targets for a chord of the song, with finger numbers as labels. */
  function chordTargets(chordId: string): Target[] {
    const v = voicingFor(chart, profile, chordId);
    if (!v) return [];
    return v.notes.map((n) => ({
      string: n.s,
      fret: n.f,
      midi: midiAt(profile, n.s, n.f),
      label: n.finger ? FINGER_INITIAL[n.finger] : "",
    }));
  }

  // Song mode, transport stopped: free practice steps through the loop's chords.
  function setSongStep(chordId: string) {
    const step = stepRef.current!;
    const v = voicingFor(chart, profile, chordId);
    const order = v?.arpeggio ?? (v ? v.notes.map((_, i) => i) : []);
    const t = chordTargets(chordId);
    step.setStep({
      targets: order.map((i) => ({ s: t[i].string, f: t[i].fret, midi: t[i].midi, role: t[i].label })),
      mode: audioRunning ? "sequence" : "shape-vision",
    });
    step.setOnAdvance(() => {
      const loop = chart.sections[0].loop;
      songChordIndexRef.current = (songChordIndexRef.current + 1) % loop.length;
    });
  }

  function startSong() {
    scorerRef.current?.reset(chart);
    setSongSummary(null);
    transport.start().catch((err) => console.error("transport error", err));
  }

  // Note events → fusion → neck relabel → lesson scoring.
  useEffect(() => {
    const fusion = fusionRef.current!;
    const step = stepRef.current!;
    const offNote = pitch.onNote((evt) => {
      const out = fusion.onNote(evt, tipsRef.current, neckFrameRef.current);
      fusionOutRef.current = out;
      if (out.deltaK !== 0) neck.nudge(out.deltaK);
      if (out.verdict === "reject") {
        neck.reset();
        fusion.clearReject();
      }
      let ok = false;
      if (modeRef.current === "song" && transportRef.current.playing) {
        const scorer = scorerRef.current!;
        const pos = chartPositionAt(chartRef.current, transportRef.current.beatsAt(evt.t));
        const res = scorer.onNote(evt, pos);
        lastSongNoteRef.current = { chordTone: res.chordTone, at: performance.now() };
        ok = res.chordTone;
      } else {
        const target = step.currentTarget;
        const res = step.onNote(evt, out);
        ok = res.hit && (!target || !out.lastConfirmed || (target.s === out.lastConfirmed.s && target.f === out.lastConfirmed.f));
      }
      if (out.lastConfirmed) {
        pulseRef.current = { s: out.lastConfirmed.s, f: out.lastConfirmed.f, ok, at: performance.now() };
      }
    });
    const offNoteOff = pitch.onNoteOff((e) => fusion.onNoteOff(e));
    return () => {
      offNote();
      offNoteOff();
    };
  }, [pitch, neck]);

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  // Webcam (or a test clip via ?src=/path.webm).
  useEffect(() => {
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    if (!video) return;
    const params = new URLSearchParams(window.location.search);
    const src = safeClipSource(params.get("src"));
    if (params.get("synthetic") === "1") {
      // Dev: render a synthetic neck into a canvas and stream it as the video.
      const scene = renderSyntheticNeck({ profile });
      const canvas = document.createElement("canvas");
      canvas.width = scene.frame.width;
      canvas.height = scene.frame.height;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(scene.frame.width, scene.frame.height);
      img.data.set(scene.frame.data);
      ctx.putImageData(img, 0, 0);
      video.srcObject = canvas.captureStream(5);
      video.onloadeddata = () => setWebcamReady(true);
      if (scene.hand) {
        const pts = scene.hand.points;
        syntheticHandsRef.current = [
          {
            label: "Right",
            score: 1,
            landmarks: pts.map((p) => ({ x: p.x / scene.frame.width, y: p.y / scene.frame.height, z: 0 })),
          },
        ];
      }
      setSourceLabel("synthetic");
      return;
    }
    if (src) {
      video.src = src;
      video.loop = true;
      video.onloadeddata = () => setWebcamReady(true);
      setSourceLabel(src);
      return;
    }
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 960, height: 540, facingMode: "user" },
          audio: false,
        });
        if (video) {
          video.srcObject = stream;
          video.onloadeddata = () => setWebcamReady(true);
        }
      } catch (err) {
        console.error("Camera error:", err);
      }
    }
    start();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [profile]);

  function loadClip(file: File) {
    const video = videoRef.current;
    if (!video) return;
    (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    video.src = URL.createObjectURL(file);
    video.loop = true;
    video.play().catch(() => {});
    setSourceLabel(file.name);
    neck.reset();
  }

  // Render loop.
  useEffect(() => {
    let rafId = 0;
    let lastMatch: MatchState = "red";
    let matchFrameCounter = 0;
    let lastFrameMs = 0;
    let frameCounter = 0;
    const FRAME_INTERVAL_MS = 1000 / 30;

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
      return { w, h, dpr };
    }

    function drawWebcam(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.clearRect(0, 0, w, h);
      const video = videoRef.current;
      const frameW = video?.videoWidth || 960;
      const frameH = video?.videoHeight || 540;
      const transform = getCoverTransform(frameW, frameH, w, h, true);
      const state = neck.stateRef.current;
      const model = state.model;
      const usable = !!model && model.confidence >= 0.2 && state.status !== "lost" && state.status !== "searching";

      const pose = poseDataRef.current;
      const hand = pose ? selectFrettingHand(pose.hands, frameW, frameH, model, swapHands) : null;
      const positions: Partial<Record<FingerName, NeckPosition>> = {};
      const fingertips: Array<{ name: string; p: { x: number; y: number }; label: string | null; color: string }> = [];
      if (hand) {
        (Object.keys(FINGERTIP_INDEX) as FingerName[]).forEach((name) => {
          const lm = hand.landmarks[FINGERTIP_INDEX[name]];
          if (!lm) return;
          const p = { x: lm.x * frameW, y: lm.y * frameH };
          let label: string | null = null;
          if (usable && model) {
            const pos = pixelToNeck(model, profile, p);
            if (pos.onNeck) {
              positions[name] = pos;
              label = `${profile.stringLabels[Math.max(0, Math.min(profile.stringCount - 1, pos.string))] ?? pos.string}|${pos.fret}`;
            }
          }
          fingertips.push({ name, p, label, color: FINGERTIP_COLORS[name] });
        });
      }
      fingerPositionsRef.current = positions;

      // Song mode: pick the current chord from the transport (or the free-practice index).
      const nowPerf = performance.now();
      let songCovered: Set<number> | null = null;
      if (modeRef.current === "song") {
        const ch = chartRef.current;
        const tr = transportRef.current;
        const loop = ch.sections[0].loop;
        let chordId: string;
        let nextId: string;
        let barIndex: number;
        let beatInBar = 0;
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
            const hit = new Set<number>();
            targetsRef.current.forEach((t, i) => {
              if (cur.tonesHit.has(pitchClassOf(t.midi))) hit.add(i);
            });
            songCovered = hit;
          }
          if (frameCounter % 10 === 0) setSongSummary(scorer.summary());
        } else {
          barIndex = songChordIndexRef.current % loop.length;
          chordId = loop[barIndex].chordId;
          nextId = loop[(barIndex + 1) % loop.length].chordId;
        }
        const key = `${chordId}|${tr.playing ? "play" : "free"}|${audioRunning}`;
        if (stepKeyRef.current !== key) {
          stepKeyRef.current = key;
          targetsRef.current = chordTargets(chordId);
          if (!tr.playing) setSongStep(chordId);
          else stepRef.current!.setStep({ targets: [], mode: "single" });
        }
        if (frameCounter % 6 === 0) {
          const bib = Math.floor(beatInBar);
          setSongChord((prev) =>
            prev.current === chordId && prev.next === nextId && prev.barIndex === barIndex && prev.beatInBar === bib
              ? prev
              : { current: chordId, next: nextId, barIndex, beatInBar: bib },
          );
        }
      }
      frameCounter++;

      // Fusion + lesson scoring inputs.
      const tAudio = pitch.context ? pitch.context.currentTime : nowPerf / 1000;
      const hist = tipHistoryRef.current;
      const tips: FingertipInput[] = (Object.keys(FINGERTIP_INDEX) as FingerName[]).map((name) => {
        const pos = positions[name];
        if (!pos) {
          delete hist[name];
          return { finger: name, neck: null, stationaryMs: 0 };
        }
        const cur = { u: pos.nFrac, v: pos.stringFrac };
        const prev = hist[name];
        if (!prev || Math.abs(prev.u - cur.u) > 0.2 || Math.abs(prev.v - cur.v) > 0.2) {
          hist[name] = { ...cur, since: nowPerf };
        }
        return { finger: name, neck: cur, stationaryMs: nowPerf - (hist[name]?.since ?? nowPerf) };
      });
      tipsRef.current = tips;
      neckFrameRef.current =
        usable && model
          ? { k: model.fretOffsetK, confidence: model.confidence, stringCount: profile.stringCount, fretCount: profile.fretCount }
          : null;
      const fusion = fusionRef.current!;
      const step = stepRef.current!;
      const fusionOut = fusion.tick(tAudio, tips, neckFrameRef.current);
      fusionOutRef.current = fusionOut;
      const view = step.onFrame(
        tips.map((tp) => ({ finger: tp.finger, neck: tp.neck })),
        fusionOut,
        tAudio,
      );
      stepViewRef.current = view;
      let light: MatchState = view.light;
      if (modeRef.current === "song" && transportRef.current.playing) {
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

      const curTargets = targetsRef.current;
      const overlayTargets: Array<{ string: number; fret: number; color: string; label?: string }> = curTargets.map((t, i) => {
        const isCurrent = view.targetIndex === i;
        const covered = songCovered ? songCovered.has(i) : view.coveredIdx.has(i) || (isCurrent && view.phase === "hit");
        const dim = !songCovered && view.targetIndex >= 0 && !isCurrent;
        return {
          string: t.string,
          fret: t.fret,
          color: covered ? TRAFFIC_COLORS.green : dim ? "#888866" : TRAFFIC_COLORS.yellow,
          label: t.label,
        };
      });
      songCoveredRef.current = songCovered;
      const pulse = pulseRef.current;
      if (pulse && nowPerf - pulse.at < 600) {
        overlayTargets.push({ string: pulse.s, fret: pulse.f, color: pulse.ok ? "#66ff99" : "#ffffff", label: "" });
      }
      drawNeckOverlay(ctx, {
        model: usable ? model : null,
        obs: neck.lastObsRef.current,
        status: state.status,
        transform,
        profile,
        debug,
        fingertips,
        targets: overlayTargets,
      });
    }

    function drawFretboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
      ctx.clearRect(0, 0, w, h);
      const padL = 40;
      const padR = 16;
      const padT = 14;
      const padB = 22;
      const boardW = w - padL - padR;
      const boardH = h - padT - padB;
      const fretW = boardW / PANEL_FRETS;
      const lanes = Math.max(1, profile.stringCount - 1);
      const stringH = boardH / lanes;

      ctx.fillStyle = "#1c1410";
      ctx.fillRect(padL, padT, boardW, boardH);

      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      for (const f of profile.inlayFrets) {
        if (f > PANEL_FRETS) continue;
        if (f === 12) {
          ctx.beginPath();
          ctx.arc(padL + 11.5 * fretW, padT + boardH / 3, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(padL + 11.5 * fretW, padT + (2 * boardH) / 3, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(padL + (f - 0.5) * fretW, padT + boardH / 2, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (let f = 0; f <= PANEL_FRETS; f++) {
        const x = padL + f * fretW;
        ctx.lineWidth = f === 0 ? 3 : 1;
        ctx.strokeStyle = f === 0 ? "rgba(255, 255, 255, 0.9)" : "rgba(200, 200, 200, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + boardH);
        ctx.stroke();
      }

      for (let s = 0; s < profile.stringCount; s++) {
        const y = padT + s * stringH;
        ctx.lineWidth = Math.max(0.6, 2 - s * 0.25);
        ctx.strokeStyle = "rgba(220, 200, 160, 0.7)";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + boardW, y);
        ctx.stroke();
        ctx.fillStyle = "rgba(220, 220, 220, 0.85)";
        ctx.font = "bold 13px monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(profile.stringLabels[s] ?? String(s), padL - 8, y);
      }

      ctx.fillStyle = "rgba(170, 170, 170, 0.7)";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let f = 1; f <= PANEL_FRETS; f++) {
        ctx.fillText(f.toString(), padL + (f - 0.5) * fretW, padT + boardH + 4);
      }

      const positions = fingerPositionsRef.current;

      const curTargets = targetsRef.current;
      const view = stepViewRef.current;
      const pulse = pulseRef.current;
      if (pulse && performance.now() - pulse.at < 600 && pulse.f <= PANEL_FRETS) {
        const x = padL + (pulse.f === 0 ? 0 : pulse.f - 0.5) * fretW;
        const y = padT + pulse.s * stringH;
        const a = 1 - (performance.now() - pulse.at) / 600;
        ctx.strokeStyle = (pulse.ok ? "rgba(102,255,153," : "rgba(255,255,255,") + a + ")";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 18 + (1 - a) * 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      curTargets.forEach((tgt, i) => {
        if (tgt.fret < 0 || tgt.fret > PANEL_FRETS) return;
        const x = padL + (tgt.fret === 0 ? 0 : (tgt.fret - 0.5)) * fretW;
        const y = padT + tgt.string * stringH;
        const isCurrent = view?.targetIndex === i;
        const sc = songCoveredRef.current;
        const covered = sc ? sc.has(i) : (view?.coveredIdx.has(i) ?? false) || (isCurrent && view?.phase === "hit");
        const dim = !sc && (view?.targetIndex ?? -1) >= 0 && !isCurrent;
        const color = covered ? TRAFFIC_COLORS.green : dim ? "#888866" : TRAFFIC_COLORS.yellow;
        const glow = ctx.createRadialGradient(x, y, 4, x, y, 22);
        glow.addColorStop(0, color + "aa");
        glow.addColorStop(1, color + "00");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tgt.label, x, y);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "9px monospace";
        ctx.fillText(noteAt(profile, tgt.string, tgt.fret), x, y - 20);
      });

      (Object.keys(FINGERTIP_INDEX) as FingerName[]).forEach((name) => {
        const fp = positions[name];
        if (!fp) return;
        const sIdx = Math.round(Math.max(0, Math.min(profile.stringCount - 1, fp.stringFrac)));
        if (fp.fret < 0 || fp.fret > PANEL_FRETS) return;
        const x = padL + (fp.fret === 0 ? 0 : fp.fret - 1 + Math.max(0.15, Math.min(0.85, fp.inFret))) * fretW;
        const y = padT + sIdx * stringH;
        ctx.fillStyle = FINGERTIP_COLORS[name] + "40";
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = FINGERTIP_COLORS[name];
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    function tick(nowMs?: number) {
      const t = nowMs ?? performance.now();
      if (t - lastFrameMs < FRAME_INTERVAL_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrameMs = t;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const wDims = sizeCanvas(webcamCanvasRef.current, webcamContainerRef.current);
      if (wDims) {
        const ctx = webcamCanvasRef.current!.getContext("2d");
        if (ctx) {
          ctx.setTransform(wDims.dpr, 0, 0, wDims.dpr, 0, 0);
          drawWebcam(ctx, wDims.w, wDims.h);
        }
      }
      const fDims = sizeCanvas(fretboardCanvasRef.current, fretboardContainerRef.current);
      if (fDims) {
        const ctx = fretboardCanvasRef.current!.getContext("2d");
        if (ctx) {
          ctx.setTransform(fDims.dpr, 0, 0, fDims.dpr, 0, 0);
          drawFretboard(ctx, fDims.w, fDims.h);
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseDataRef, neck, profile, debug, swapHands, pitch.context, audioRunning]);

  const neckStatus = neck.status;
  const status = !webcamReady
    ? "Starting video..."
    : handsLoading
      ? "Loading hand tracking..."
      : mode === "song"
        ? `${song.title} · ${song.key} · neck: ${neckStatus}`
        : `${keyName} ${shape.name} · neck: ${neckStatus}`;
  const currentVoicing = voicingFor(chart, profile, songChord.current);
  const nextVoicing = voicingFor(chart, profile, songChord.next);
  const loopBars = chart.sections[0].loop;
  const selectedDeviceLabel = pitch.devices.find((d) => d.deviceId === pitch.selectedDeviceId)?.label ?? "";

  const locked = neckStatus === "locked";

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden flex flex-col">
      <div className="relative z-10 p-3 sm:p-4 flex items-start justify-between flex-shrink-0 gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">{profile.name.toLowerCase()}.lab</h1>
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
            <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">Spark not detected: check USB-C and power, then pick it →</span>
          )}
          {pitch.error && pitch.status === "error" && (
            <span className="text-[11px] font-mono text-red-300 max-w-[240px] truncate" title={pitch.error}>
              {/NotAllowed|Permission/i.test(pitch.error) ? "microphone blocked: allow it in the browser's site settings" : pitch.error}
            </span>
          )}
          {pitch.status === "needs-device" && (
            <select
              onChange={(e) => e.target.value && pitch.selectDevice(e.target.value)}
              defaultValue=""
              className="text-[11px] font-mono px-2 py-1 rounded bg-black/60 border border-white/10 text-white max-w-[180px]"
            >
              <option value="">choose input…</option>
              {pitch.devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>
              ))}
            </select>
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
        <Link
          href="/"
          className="text-xs text-zinc-400 hover:text-white active:scale-95 transition px-3 py-1.5 rounded-full bg-white/10 border border-white/10 flex-shrink-0"
        >
          ← back
        </Link>
      </div>

      <div ref={webcamContainerRef} className="relative flex-1 min-h-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas ref={webcamCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

        {/* Neck controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
          <div className="flex gap-1">
            <button onClick={() => neck.lock(!locked)} className={`text-[11px] font-mono px-2 py-1 rounded border border-white/10 ${locked ? "bg-white text-black" : "bg-black/50 hover:bg-white/20"}`}>
              {locked ? "Unlock neck" : "Lock neck"}
            </button>
            <button onClick={() => neck.nudge(-1)} className="text-[11px] font-mono px-2 py-1 rounded bg-black/50 hover:bg-white/20 border border-white/10">−1 fret</button>
            <button onClick={() => neck.nudge(1)} className="text-[11px] font-mono px-2 py-1 rounded bg-black/50 hover:bg-white/20 border border-white/10">+1 fret</button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => neck.flipOrientation()} className="text-[11px] font-mono px-2 py-1 rounded bg-black/50 hover:bg-white/20 border border-white/10">Flip nut↔bridge</button>
            <button onClick={() => neck.flipStrings()} className="text-[11px] font-mono px-2 py-1 rounded bg-black/50 hover:bg-white/20 border border-white/10">Flip strings</button>
            <button onClick={() => neck.reset()} className="text-[11px] font-mono px-2 py-1 rounded bg-black/50 hover:bg-white/20 border border-white/10">Reset</button>
          </div>
          {neck.driftWarning && (
            <div className="text-[11px] font-mono px-2 py-1 rounded bg-yellow-500/80 text-black">neck moved — unlock?</div>
          )}
          {(neckStatus === "lost" || neckStatus === "searching") && webcamReady && !handsLoading && (
            <div className="text-[11px] font-mono px-2 py-1 rounded bg-black/60 border border-white/10 text-zinc-300">
              show the neck and fretting hand
            </div>
          )}
        </div>

        {debug && (
          <div className="absolute bottom-3 right-3 flex gap-1 items-center text-[11px] font-mono">
            <label className="px-2 py-1 rounded bg-black/50 border border-white/10 cursor-pointer hover:bg-white/20">
              load clip
              <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadClip(e.target.files[0])} />
            </label>
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (paused) v.play().catch(() => {});
                else v.pause();
                setPaused(!paused);
              }}
              className="px-2 py-1 rounded bg-black/50 border border-white/10 hover:bg-white/20"
            >
              {paused ? "play" : "pause"}
            </button>
            <button onClick={() => neck.detectNow()} className="px-2 py-1 rounded bg-black/50 border border-white/10 hover:bg-white/20">detect once</button>
            <button onClick={() => console.log("neck observation", neck.lastObsRef.current, neck.debugRef.current)} className="px-2 py-1 rounded bg-black/50 border border-white/10 hover:bg-white/20">dump</button>
            <button onClick={() => setSwapHands((v) => !v)} className={`px-2 py-1 rounded border border-white/10 ${swapHands ? "bg-white text-black" : "bg-black/50 hover:bg-white/20"}`}>swap hands</button>
            <span className="text-zinc-500 px-1">{sourceLabel}</span>
          </div>
        )}

        {debug && (
          <div className="absolute top-3 left-3">
            <PitchDebugPanel
              pitch={pitch}
              profile={profile}
              getFusion={() => fusionOutRef.current}
              getStep={() => stepViewRef.current}
              neckK={neck.stateRef.current.model?.fretOffsetK ?? null}
            />
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
        <div ref={fretboardContainerRef} className="relative h-36 sm:h-44">
          <canvas ref={fretboardCanvasRef} className="absolute inset-0 w-full h-full" />
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
                {!audioRunning && <span className="text-zinc-500">connect the guitar to score notes</span>}
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
          )}
          {mode === "shapes" && (
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
          )}
        </div>
      </div>
    </div>
  );
}
