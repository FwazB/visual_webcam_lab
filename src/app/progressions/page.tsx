import type { Metadata, Viewport } from "next";
import ProgressionGenerator from "@/components/ProgressionGenerator";

export const metadata: Metadata = {
  title: "Chord progression generator | body.synth",
  description: "Learn chord changes on guitar or bass with six songs from easy to advanced, or generate your own four-chord loop.",
};

export const viewport: Viewport = { maximumScale: 5, userScalable: true };

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
    initialMode={mode === "free" ? "free" : "song"}
    initialSongId={typeof song === "string" ? song : undefined}
  />;
}
