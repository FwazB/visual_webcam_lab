"use client";

import dynamic from "next/dynamic";

const BassLab = dynamic(() => import("@/components/BassLab"), {
  ssr: false,
});

export default function BassPage() {
  return <BassLab />;
}
