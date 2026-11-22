import type { Metadata, Viewport } from "next";
import ProgressionGenerator from "@/components/ProgressionGenerator";

export const metadata: Metadata = {
  title: "Chord progression generator | body.synth",
  description: "Find a four-chord loop for electric guitar or bass, hear it, and learn the fingering for each chord.",
};

export const viewport: Viewport = { maximumScale: 5, userScalable: true };

export default async function ProgressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ instrument?: string | string[] }>;
}) {
  const { instrument } = await searchParams;
  return <ProgressionGenerator initialInstrument={instrument === "bass" ? "bass" : "guitar"} />;
}
