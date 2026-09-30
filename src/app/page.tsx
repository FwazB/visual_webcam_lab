import type { Metadata } from "next";
import Link from "next/link";
import { Anton, Caveat, Instrument_Serif } from "next/font/google";
import { Doodle } from "@/components/home/doodles";
import LiveStamp from "@/components/home/LiveStamp";
import Reveal from "@/components/home/Reveal";
import StringsHero from "@/components/home/StringsHero";
import styles from "@/components/home/home.module.css";
import { GUITAR_STANDARD } from "@/lib/instrument/profile";
import { pitchClassHue } from "@/lib/instrument/pitch";
import { PROJECTS, STRUNG_PROJECTS } from "@/lib/home/projects";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const serif = Instrument_Serif({ weight: "400", style: "italic", subsets: ["latin"], variable: "--font-serif" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-hand" });

export const metadata: Metadata = {
  title: "body.synth",
  description: "Things I'm making with a guitar, a webcam and TouchDesigner.",
};

const TILTS = [-1.2, 0.8, -0.6, 1.3, -1, 0.5, -0.8];

export default function Home() {
  return (
    <div className={`${styles.page} ${anton.variable} ${serif.variable} ${hand.variable}`}>
      <div className={styles.inner}>
        <header className={styles.masthead}>
          <div>
            <p className={styles.kicker}>Vol. 1 · things I&apos;m making</p>
            <h1 className={styles.title}>
              <span className={styles.titlePink} aria-hidden="true">
                body.synth
              </span>
              <span className={styles.titleInk}>body.synth</span>
            </h1>
            <p className={styles.subtitle}>experiments with a guitar, a webcam, and TouchDesigner</p>
          </div>
          <LiveStamp />
        </header>

        <StringsHero />

        <section className={styles.things} aria-labelledby="things-title">
          <div className={styles.sectionHead}>
            <h2 id="things-title" className={styles.sectionTitle}>
              things I&apos;m <span className={styles.marker}>making</span>
            </h2>
            <p className={styles.hand}>all of it runs on one laptop</p>
          </div>
          <Reveal className={styles.grid}>
            {PROJECTS.map((p, i) => {
              const hue = pitchClassHue(p.pitchClass);
              const stringIndex = STRUNG_PROJECTS.findIndex((s) => s.id === p.id);
              const where = p.external ? "TouchDesigner" : "web";
              const meta = stringIndex >= 0 ? `${GUITAR_STANDARD.stringLabels[stringIndex]} string · ${where}` : where;
              const body = (
                <>
                  <Doodle id={p.doodle} hue={hue} className={styles.doodle} />
                  <span className={styles.cardMeta}>
                    <span className={styles.swatch} style={{ background: `hsl(${hue} 95% 52%)` }} />
                    {meta}
                  </span>
                  <h3 className={styles.cardTitle}>{p.title}</h3>
                  <p className={styles.cardBlurb}>{p.blurb}</p>
                  <span className={styles.cardOpen}>{p.external ? "on GitHub ↗" : "open ▸"}</span>
                </>
              );
              return (
                <li key={p.id} className={styles.card} style={{ "--i": i, "--tilt": `${TILTS[i % TILTS.length]}deg` } as React.CSSProperties}>
                  {p.external ? (
                    <a href={p.href} target="_blank" rel="noreferrer" className={styles.cardLink}>
                      {body}
                    </a>
                  ) : (
                    <Link href={p.href} className={styles.cardLink}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </Reveal>
        </section>

        <footer className={styles.footer}>
          <span>made with a guitar, a webcam and a laptop</span>
          <a href="https://github.com/FwazB/visual_webcam_lab" target="_blank" rel="noreferrer">
            source on GitHub ↗
          </a>
        </footer>
      </div>
    </div>
  );
}
