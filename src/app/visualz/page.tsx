"use client";

import dynamic from "next/dynamic";

const Visualz = dynamic(() => import("@/components/Visualz"), {
  ssr: false,
});

export default function VisualzPage() {
  return <Visualz />;
}
