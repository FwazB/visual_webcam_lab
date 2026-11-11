"use client";

// Homepage hero: six guitar strings and a virtual low A, one per project. Moving a mouse across
// them strums; a tap plucks the nearest. Plucked strings vibrate and print a
// second ink layer in their pitch color, slightly out of register. Sound is
// optional and only starts after the speaker toggle is pressed.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { midiToHz, pitchClassHue } from "@/lib/instrument/pitch";
import { cloudString, karplusStrong } from "@/lib/home/pluck";
import { STRUNG_PROJECTS } from "@/lib/home/projects";
import { amplitudeFor, crossedStrings, displacement, energy, SETTLED, type Pluck } from "@/lib/home/strings";
import styles from "./home.module.css";

const INK = "#22306b";
const POINTS = 96;
/** Nut and bridge inset from the hero edges (px). */
const END_INSET = 18;

interface StringState {
  y: number;
  hue: number;
  plucks: Pluck[];
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface Sound {
  ctx: AudioContext;
  buffers: AudioBuffer[];
  voices: Array<Voice | null>;
}

interface Engine {
  pluck: (index: number, at: number, amplitude: number) => void;
  focus: (index: number | null) => void;
  gap: () => number;
}

export default function StringsHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const engineRef = useRef<Engine | null>(null);
  const soundRef = useRef<Sound | null>(null);
  const soundOnRef = useRef(false);
  const mountedRef = useRef(false);
  const activationRef = useRef(0);
  const timersRef = useRef(new Set<number>());
  const [soundOn, setSoundOn] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);

  const schedule = useCallback((fn: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      if (mountedRef.current) fn();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!hero || !canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const strings: StringState[] = STRUNG_PROJECTS.map((p) => ({ y: 0, hue: pitchClassHue(p.pitchClass), plucks: [] }));
    let width = 0;
    let height = 0;
    let dpr = 1;
    let focused: number | null = null;
    let raf = 0;
    let prev: { x: number; y: number; t: number } | null = null;

    const gap = () => (strings.length > 1 ? (strings[strings.length - 1].y - strings[0].y) / (strings.length - 1) : 40);
    const span = () => Math.max(1, width - 2 * END_INSET);

    function measure() {
      const box = hero!.getBoundingClientRect();
      width = box.width;
      height = box.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      // Each string runs through the middle of its label, so links and strings stay aligned.
      labelRefs.current.forEach((label, i) => {
        if (!label) return;
        const r = label.getBoundingClientRect();
        strings[i].y = r.top + r.height / 2 - box.top;
      });
    }

    function draw() {
      raf = 0;
      // performance.now(), not the rAF timestamp: a frame can start before the
      // pointer event that plucked, which would read as a pluck from the future.
      const t = performance.now() / 1000;
      const still = reduceMotion.matches;
      let moving = false;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      const ys = new Float32Array(POINTS + 1);
      strings.forEach((s, i) => {
        const project = STRUNG_PROJECTS[i];
        s.plucks = s.plucks.filter((p) => energy(p, t) > SETTLED);
        const e = s.plucks.reduce((m, p) => Math.max(m, energy(p, t)), 0);
        if (e > 0) moving = true;
        for (let k = 0; k <= POINTS; k++) {
          let y = s.y;
          if (!still) for (const p of s.plucks) y += displacement(p, k / POINTS, t);
          if (project.voice === "cloud") {
            const x = k / POINTS;
            y += Math.sin(Math.PI * x) * (Math.sin(x * 92 + (still ? 0 : e * 5)) * 1.6 + Math.sin(x * 211) * 0.7);
          }
          ys[k] = y;
        }
        const trace = (dx: number, dy: number) => {
          ctx!.beginPath();
          for (let k = 0; k <= POINTS; k++) {
            const x = END_INSET + (span() * k) / POINTS + dx;
            if (k === 0) ctx!.moveTo(x, ys[k] + dy);
            else ctx!.lineTo(x, ys[k] + dy);
          }
          ctx!.stroke();
        };
        if (project.voice === "cloud") {
          // A static cloud at rest; distortion follows a pluck, never an idle loop.
          ctx!.save();
          const fog = ctx!.createLinearGradient(0, s.y - 22, 0, s.y + 22);
          fog.addColorStop(0, "#b390ff00");
          fog.addColorStop(0.3, "#ae6cff55");
          fog.addColorStop(0.5, "#101a3acb");
          fog.addColorStop(0.7, "#50dce888");
          fog.addColorStop(1, "#50dce800");
          ctx!.beginPath();
          for (let k = 0; k <= POINTS; k++) {
            const x = k / POINTS;
            const cloud = Math.sin(Math.PI * x) * (10 + 5 * Math.sin(x * 31) ** 2);
            const px = END_INSET + span() * x;
            if (k === 0) ctx!.moveTo(px, s.y - cloud);
            else ctx!.lineTo(px, s.y - cloud);
          }
          for (let k = POINTS; k >= 0; k--) {
            const x = k / POINTS;
            ctx!.lineTo(END_INSET + span() * x, s.y + Math.sin(Math.PI * x) * (9 + 6 * Math.sin(x * 27 + 1) ** 2));
          }
          ctx!.closePath();
          ctx!.fillStyle = fog;
          ctx!.fill();
          ctx!.shadowBlur = 12 + Math.min(8, e * 6);
          ctx!.shadowColor = "#9567ed";
          ctx!.strokeStyle = "#282047";
          ctx!.lineWidth = project.gauge + 4;
          trace(0, 0);
          ctx!.shadowColor = "#6fe9f5";
          ctx!.strokeStyle = "#7af7ff";
          ctx!.lineWidth = project.gauge;
          trace(0, -0.8);
          ctx!.shadowBlur = 0;
          ctx!.strokeStyle = "#eccdff";
          ctx!.lineWidth = 1;
          trace(0, 1.4);
          ctx!.restore();
          return;
        }
        // Pitch-colored layer, printed a little out of register.
        const colorAlpha = Math.max(focused === i ? 0.85 : 0, Math.min(1, e * 1.6));
        if (colorAlpha > 0.01) {
          ctx!.strokeStyle = `hsl(${s.hue} 95% 52% / ${colorAlpha})`;
          ctx!.lineWidth = project.gauge + 3;
          trace(1.8, 1.4);
        }
        ctx!.strokeStyle = INK;
        ctx!.lineWidth = project.gauge;
        trace(0, 0);
      });
      // Nut and bridge.
      if (strings.length) {
        const top = strings[0].y - 14;
        const bottom = strings[strings.length - 1].y + 14;
        ctx!.fillStyle = INK;
        ctx!.fillRect(END_INSET - 7, top, 6, bottom - top);
        ctx!.fillRect(width - END_INSET + 1, top, 3, bottom - top);
      }
      if (moving && !still && !document.hidden) raf = requestAnimationFrame(draw);
    }

    const kick = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
    };

    const play = (index: number, velocity: number, pan: number) => {
      const sound = soundRef.current;
      if (!mountedRef.current || !soundOnRef.current || !sound || sound.ctx.state !== "running") return;
      const { ctx: audio, buffers, voices } = sound;
      const now = audio.currentTime;
      // Re-picking a string stops its previous note, as on a real guitar.
      const old = voices[index];
      if (old) {
        old.gain.gain.setTargetAtTime(0, now, 0.01);
        old.source.stop(now + 0.05);
      }
      const source = audio.createBufferSource();
      source.buffer = buffers[index];
      const gain = audio.createGain();
      gain.gain.value = 0.06 + 0.3 * velocity;
      const panner = audio.createStereoPanner();
      panner.pan.value = (pan * 2 - 1) * 0.6;
      source.connect(gain).connect(panner).connect(audio.destination);
      source.start(now);
      voices[index] = { source, gain };
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        panner.disconnect();
        if (voices[index]?.source === source) voices[index] = null;
      };
    };

    const pluck = (index: number, at: number, amplitude: number) => {
      const s = strings[index];
      if (!mountedRef.current || !s || document.hidden) return;
      s.plucks.push({ at, amplitude, t0: performance.now() / 1000 });
      if (s.plucks.length > 3) s.plucks.shift();
      play(index, Math.min(1, Math.abs(amplitude) / (gap() * 0.42)), at);
      kick();
    };

    engineRef.current = {
      pluck,
      focus: (index) => {
        focused = index;
        kick();
      },
      gap,
    };

    const local = (e: PointerEvent) => {
      const box = hero.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const along = (x: number) => Math.min(0.97, Math.max(0.03, (x - END_INSET) / span()));

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const { x, y } = local(e);
      const t = performance.now();
      if (prev) {
        const crossed = crossedStrings(prev.y, y, strings.map((s) => s.y));
        if (crossed.length) {
          const speed = Math.hypot(x - prev.x, y - prev.y) / Math.max(1, t - prev.t);
          const amplitude = amplitudeFor(speed, gap()) * Math.sign(y - prev.y || 1);
          crossed.forEach((i) => pluck(i, along(x), amplitude));
        }
      }
      prev = { x, y, t };
    };
    const onLeave = () => {
      prev = null;
    };
    const onDown = (e: PointerEvent) => {
      const { x, y } = local(e);
      let nearest = -1;
      let best = gap() / 2;
      strings.forEach((s, i) => {
        const d = Math.abs(s.y - y);
        if (d < best) {
          best = d;
          nearest = i;
        }
      });
      if (nearest >= 0) pluck(nearest, along(x), gap() * 0.3);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        kick();
      }
    };

    const observer = new ResizeObserver(() => {
      measure();
      kick();
    });
    observer.observe(hero);
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    hero.addEventListener("pointerdown", onDown);
    document.addEventListener("visibilitychange", onVisibility);
    reduceMotion.addEventListener("change", kick);

    // Explanation: one soft strum after the strings have drawn in, so the
    // page shows it is playable before anyone touches it.
    if (!reduceMotion.matches) schedule(() => {
      strings.forEach((_, i) => schedule(() => pluck(i, 0.36, gap() * 0.14), i * 45));
    }, 1300);

    return () => {
      mountedRef.current = false;
      activationRef.current = activationRef.current + 1;
      timers.forEach(window.clearTimeout);
      timers.clear();
      cancelAnimationFrame(raf);
      observer.disconnect();
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      hero.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotion.removeEventListener("change", kick);
      engineRef.current = null;
    };
  }, [schedule]);

  useEffect(
    () => () => {
      soundRef.current?.ctx.close().catch(() => {});
      soundRef.current = null;
    },
    [],
  );

  async function toggleSound() {
    const activation = ++activationRef.current;
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    setSoundError(null);
    if (!next) {
      await soundRef.current?.ctx.suspend().catch(() => {});
      return;
    }
    try {
      if (!soundRef.current) {
        const ctx = new AudioContext({ latencyHint: "interactive" });
        const buffers = STRUNG_PROJECTS.map((project) => {
          const synth = project.voice === "cloud" ? cloudString : karplusStrong;
          const data = synth(midiToHz(project.midi), ctx.sampleRate, 2.5);
          const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
          buffer.copyToChannel(data, 0);
          return buffer;
        });
        soundRef.current = { ctx, buffers, voices: buffers.map(() => null) };
      }
      await soundRef.current.ctx.resume();
      if (!mountedRef.current || activation !== activationRef.current || !soundOnRef.current) return;
    } catch {
      if (mountedRef.current && activation === activationRef.current) {
        soundOnRef.current = false;
        setSoundOn(false);
        setSoundError("Sound is unavailable. You can still open every project.");
      }
      return;
    }
    // Feedback: a quick strum so it's obvious sound is on.
    const engine = engineRef.current;
    if (engine) STRUNG_PROJECTS.forEach((_, i) => schedule(() => engine.pluck(i, 0.4, engine.gap() * 0.2), i * 40));
  }

  const fineHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <section className={styles.hero} ref={heroRef} aria-label="Seven project strings">
      <canvas ref={canvasRef} className={styles.strings} aria-hidden="true" />
      <ol className={styles.labels}>
        {STRUNG_PROJECTS.map((p, i) => {
          const label = (
            <>
              <span className={styles.labelLetter} style={p.voice === "cloud" ? undefined : { background: `hsl(${pitchClassHue(p.pitchClass)} 95% 52%)` }}>
                {p.stringLabel}
              </span>
              <span className={styles.labelTitle}>{p.title}</span>
              <span aria-hidden="true">{p.external ? "↗" : "▸"}</span>
            </>
          );
          const common = {
            className: `${styles.label} ${p.voice === "cloud" ? styles.cloudLabel : ""}`,
            "aria-label": p.voice === "cloud" ? "Pocket Operators — virtual A string" : undefined,
            style: { "--i": i, "--tilt": `${[-1.5, 1, -0.5, 1.5, -1, 0.5, -0.7][i]}deg` } as React.CSSProperties,
            ref: (el: HTMLAnchorElement | null) => {
              labelRefs.current[i] = el;
            },
            onPointerEnter: (e: React.PointerEvent) => {
              const engine = engineRef.current;
              if (engine && e.pointerType === "mouse" && fineHover()) engine.pluck(i, 0.85, engine.gap() * 0.16);
            },
            onFocus: (e: React.FocusEvent<HTMLAnchorElement>) => {
              if (e.currentTarget.matches(":focus-visible")) engineRef.current?.focus(i);
            },
            onBlur: () => engineRef.current?.focus(null),
          };
          return (
            <li key={p.id}>
              {p.external ? (
                <a href={p.href} target="_blank" rel="noreferrer" {...common}>
                  {label}
                </a>
              ) : (
                <Link href={p.href} {...common}>
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <p className={styles.heroNote} aria-hidden="true">
        <span className={styles.noteFine}>move across the strings</span>
        <span className={styles.noteTouch}>tap a string</span>
        <svg viewBox="0 0 60 30" className={styles.noteArrow}>
          <path d="M4 24C20 26 38 20 52 8M44 8L53 7L52 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </p>
      {soundError && <p className={styles.soundError} role="status">{soundError}</p>}
      <button type="button" className={styles.sound} onClick={toggleSound} aria-pressed={soundOn}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9H8L13 5V19L8 15H4Z" fill="currentColor" />
          {soundOn ? (
            <path d="M16 9C17.5 10.5 17.5 13.5 16 15M18.5 6.5C21.5 9.5 21.5 14.5 18.5 17.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M16.5 9.5L21 14M21 9.5L16.5 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
        sound {soundOn ? "on" : "off"}
      </button>
    </section>
  );
}
