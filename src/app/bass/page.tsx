"use client";

import dynamic from "next/dynamic";
import { BASS_STANDARD } from "@/lib/instrument/profile";

const FretLab = dynamic(() => import("@/components/FretLab"), { ssr: false });

export default function BassPage() {
  return <FretLab profile={BASS_STANDARD} />;
}
