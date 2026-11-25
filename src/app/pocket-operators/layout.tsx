import type { Metadata, Viewport } from "next";
import Link from "next/link";
import styles from "./guide.module.css";

export const metadata: Metadata = {
  title: { default: "Pocket Operator guide | body.synth", template: "%s | body.synth" },
  description: "Learn PO-12 Rhythm, PO-33 K.O! and PO-16 Factory individually, then play all three in sync.",
};

export const viewport: Viewport = { maximumScale: 5, userScalable: true };

export default function PocketGuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.navigation}>
          <Link href="/" className={styles.brand}>body.synth</Link>
          <nav aria-label="Main navigation">
            <Link href="/guitar">Guitar</Link>
            <Link href="/bass">Bass</Link>
            <Link href="/studio">Studio</Link>
            <Link href="/for-you">For you</Link>
            <Link href="/pocket-operators" aria-current="location">Pocket Operators</Link>
          </nav>
        </header>
        {children}
        <footer className={styles.footer}>
          <Link href="/">Back to body.synth</Link>
          <p>Independent learning guide. Button references come from the manufacturer’s manuals.</p>
        </footer>
      </div>
    </div>
  );
}
