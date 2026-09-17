"use client";

import dynamic from "next/dynamic";
import { GUITAR_STANDARD } from "@/lib/instrument/profile";

const FretLab = dynamic(() => import("@/components/FretLab"), { ssr: false });

export default function GuitarPage() {
  return <FretLab profile={GUITAR_STANDARD} />;
}
