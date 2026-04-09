"use client";

import dynamic from "next/dynamic";

const AsciiCamera = dynamic(() => import("@/components/AsciiCamera"), {
  ssr: false,
});

export default function AsciiPage() {
  return <AsciiCamera />;
}
