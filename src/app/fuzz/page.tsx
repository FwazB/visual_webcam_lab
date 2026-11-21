import type { Metadata, Viewport } from "next";
import Link from "next/link";
import FuzzController from "@/components/FuzzController";
import BrowserFuzz from "@/components/BrowserFuzz";
import { FUZZ_PROJECT_URL } from "@/lib/home/projects";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Fuzz | body.synth",
  description: "Control Fuzz trails with head tilt from AirPods connected to your Mac or iPhone.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#f2ecdf",
};

export default function FuzzPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header>
          <nav className={styles.navigation} aria-label="Fuzz navigation">
            <Link className={styles.brand} href="/" aria-label="body.synth home">body.synth</Link>
            <a className={styles.projectLink} href={FUZZ_PROJECT_URL}>
              TouchDesigner project <span aria-hidden="true">↗</span>
            </a>
          </nav>
          <h1 className={styles.title}>Fuzz</h1>
        </header>
        <BrowserFuzz />
        <details className={styles.desktop}>
          <summary>TouchDesigner output</summary>
          <FuzzController />
        </details>
      </div>
    </main>
  );
}
