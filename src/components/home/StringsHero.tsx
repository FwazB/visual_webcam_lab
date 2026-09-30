"use client";

// Homepage hero: six guitar strings, one per project. Moving a mouse across
// them strums; a tap plucks the nearest. Plucked strings vibrate and print a
// second ink layer in their pitch color, slightly out of register. Sound is
// optional and only starts after the speaker toggle is pressed.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GUITAR_STANDARD } from "@/lib/instrument/profile";
import { midiToHz, pitchClassHue } from "@/lib/instrument/pitch";
import { karplusStrong } from "@/lib/home/pluck";
import { STRUNG_PROJECTS } from "@/lib/home/projects";
import { amplitudeFor, crossedStrings, displacement, energy, SETTLED, type Pluck } from "@/lib/home/strings";
import styles from "./home.module.css";

const INK = "#22306b";
const POINTS = 96;
/** Line width per string, low E to high e. */
const GAUGE = [3.4, 2.9, 2.4, 2, 1.6, 1.3];
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
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
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
        s.plucks = s.plucks.filter((p) => energy(p, t) > SETTLED);
        const e = s.plucks.reduce((m, p) => Math.max(m, energy(p, t)), 0);
        if (e > 0) moving = true;
        for (let k = 0; k <= POINTS; k++) {
          let y = s.y;
          if (!still) for (const p of s.plucks) y += displacement(p, k / POINTS, t);
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
        // Pitch-colored layer, printed a little out of register.
        const colorAlpha = Math.max(focused === i ? 0.85 : 0, Math.min(1, e * 1.6));
        if (colorAlpha > 0.01) {
          ctx!.strokeStyle = `hsl(${s.hue} 95% 52% / ${colorAlpha})`;
          ctx!.lineWidth = GAUGE[i] + 3;
          trace(1.8, 1.4);
        }
        ctx!.strokeStyle = INK;
        ctx!.lineWidth = GAUGE[i];
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
      if (moving && !document.hidden) raf = requestAnimationFrame(draw);
    }

    const kick = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
    };

    const play = (index: number, velocity: number, pan: number) => {
      const sound = soundRef.current;
      if (!soundOnRef.current || !sound) return;
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
        if (voices[index]?.source === source) voices[index] = null;
      };
    };

    const pluck = (index: number, at: number, amplitude: number) => {
      const s = strings[index];
      if (!s) return;
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

    // Explanation: one soft strum after the strings have drawn in, so the
    // page shows it is playable before anyone touches it.
    const intro = window.setTimeout(() => {
      strings.forEach((_, i) => window.setTimeout(() => pluck(i, 0.36, gap() * 0.14), i * 45));
    }, 1300);

    return () => {
      window.clearTimeout(intro);
      cancelAnimationFrame(raf);
      observer.disconnect();
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      hero.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVisibility);
      engineRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      soundRef.current?.ctx.close().catch(() => {});
      soundRef.current = null;
    },
    [],
  );

  async function toggleSound() {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    if (!next) {
      await soundRef.current?.ctx.suspend().catch(() => {});
      return;
    }
    if (!soundRef.current) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      const buffers = GUITAR_STANDARD.tuning.map((midi) => {
        const data = karplusStrong(midiToHz(midi), ctx.sampleRate, 2.5);
        const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buffer.copyToChannel(data, 0);
        return buffer;
      });
      soundRef.current = { ctx, buffers, voices: buffers.map(() => null) };
    }
    await soundRef.current.ctx.resume().catch(() => {});
    // Feedback: a quick strum so it's obvious sound is on.
    const engine = engineRef.current;
    if (engine) STRUNG_PROJECTS.forEach((_, i) => window.setTimeout(() => engine.pluck(i, 0.4, engine.gap() * 0.2), i * 40));
  }

  const fineHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <section className={styles.hero} ref={heroRef} aria-label="Projects, one per string">
      <canvas ref={canvasRef} className={styles.strings} aria-hidden="true" />
      <ol className={styles.labels}>
        {STRUNG_PROJECTS.map((p, i) => {
          const label = (
            <>
              <span className={styles.labelLetter} style={{ background: `hsl(${pitchClassHue(p.pitchClass)} 95% 52%)` }}>
                {GUITAR_STANDARD.stringLabels[i]}
              </span>
              <span className={styles.labelTitle}>{p.title}</span>
              <span aria-hidden="true">{p.external ? "↗" : "▸"}</span>
            </>
          );
          const common = {
            className: styles.label,
            style: { "--i": i, "--tilt": `${[-1.5, 1, -0.5, 1.5, -1, 0.5][i]}deg` } as React.CSSProperties,
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
