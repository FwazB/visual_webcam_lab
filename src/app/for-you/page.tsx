"use client";

import dynamic from "next/dynamic";

const SongsForYou = dynamic(() => import("@/components/SongsForYou"), {
  ssr: false,
  loading: () => <p className="p-8 text-zinc-400">Loading your practice picks…</p>,
});

export default function ForYouPage() {
  return <SongsForYou />;
}
