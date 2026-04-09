"use client";

import dynamic from "next/dynamic";

const BodySynth = dynamic(() => import("@/components/BodySynth"), {
  ssr: false,
});

export default function Home() {
  return <BodySynth />;
}
