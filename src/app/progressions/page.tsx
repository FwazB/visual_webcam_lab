import type { Metadata, Viewport } from "next";
import ProgressionGenerator from "@/components/ProgressionGenerator";

export const metadata: Metadata = {
  title: "Chord progressions | body.synth",
  description: "Explore the song library, generate a progression, or build your own chord changes for guitar or bass.",
  applicationName: "Body Synth Progressions",
  manifest: "/progressions/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Progressions", statusBarStyle: "default" },
  icons: {
    apple: [{ url: "/progressions/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { maximumScale: 5, userScalable: true, themeColor: "#f2ecdf" };

export default async function ProgressionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    instrument?: string | string[];
    mode?: string | string[];
    song?: string | string[];
  }>;
}) {
  const { instrument, mode, song } = await searchParams;
  return <ProgressionGenerator
    initialInstrument={instrument === "bass" ? "bass" : "guitar"}
    initialMode={mode === "free" || mode === "custom" ? mode : "song"}
    initialSongId={typeof song === "string" ? song : undefined}
  />;
}
