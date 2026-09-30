// Hand-drawn doodles for the homepage cards: navy ink line art over a
// halftone fill printed slightly out of register, like a two-color riso.

import type { ReactNode } from "react";
import type { DoodleId } from "@/lib/home/projects";

interface Art {
  /** Areas printed in the halftone color layer. */
  fill: ReactNode;
  /** Navy line work on top. */
  ink: ReactNode;
}

const ART: Record<DoodleId, Art> = {
  guitar: {
    fill: <path d="M20 52C20 36 36 32 46 38C52 34 64 36 66 44L66 58C64 66 52 68 46 64C36 72 20 68 20 52Z" />,
    ink: (
      <>
        <path d="M20 52C20 36 36 32 46 38C52 34 64 36 66 44L66 58C64 66 52 68 46 64C36 72 20 68 20 52Z" />
        <circle cx="46" cy="51" r="6" />
        <path d="M66 47L104 46L104 55L66 56" />
        <path d="M104 44L116 41L117 58L104 56Z" />
        <path d="M30 49.5L110 48.5M30 52.5L110 52" strokeWidth="1" />
        <path d="M76 46V56M86 46V55M95 46V55" strokeWidth="1.2" />
      </>
    ),
  },
  bass: {
    fill: <path d="M12 54C10 40 24 34 34 40C42 36 50 38 52 44L52 60C48 68 38 70 32 64C22 72 12 66 12 54Z" />,
    ink: (
      <>
        <path d="M12 54C10 40 24 34 34 40C42 36 50 38 52 44L52 60C48 68 38 70 32 64C22 72 12 66 12 54Z" />
        <rect x="24" y="47" width="10" height="11" rx="2" />
        <path d="M52 48L106 47L106 55L52 56" />
        <path d="M106 45L118 42L118 59L106 57Z" />
        <path d="M110 40V44M115 39V43M110 58V62M115 59V63" />
        <path d="M22 50L112 49.5M22 53L112 52.5" strokeWidth="1" />
      </>
    ),
  },
  cassette: {
    fill: <rect x="20" y="26" width="80" height="22" rx="3" />,
    ink: (
      <>
        <rect x="10" y="18" width="100" height="58" rx="6" />
        <rect x="20" y="26" width="80" height="22" rx="3" />
        <circle cx="42" cy="37" r="7" />
        <circle cx="78" cy="37" r="7" />
        <path d="M38 37H46M42 33V41M74 37H82M78 33V41" strokeWidth="1.4" />
        <path d="M30 76L36 62H84L90 76" />
        <path d="M24 56Q60 60 96 55" strokeWidth="1" strokeDasharray="3 4" />
      </>
    ),
  },
  headphones: {
    fill: (
      <>
        <rect x="16" y="50" width="18" height="30" rx="7" />
        <rect x="86" y="50" width="18" height="30" rx="7" />
      </>
    ),
    ink: (
      <>
        <path d="M24 56C22 22 98 22 96 56" />
        <rect x="16" y="50" width="18" height="30" rx="7" />
        <rect x="86" y="50" width="18" height="30" rx="7" />
        <path d="M52 44V60M52 44L64 41V56" />
        <circle cx="49" cy="61" r="3.5" />
        <circle cx="61" cy="57" r="3.5" />
      </>
    ),
  },
  ascii: {
    fill: <rect x="16" y="12" width="88" height="56" rx="4" />,
    ink: (
      <>
        <rect x="16" y="12" width="88" height="56" rx="4" />
        <path d="M54 68L50 80H70L66 68M42 81H78" />
        <text x="24" y="30" fontFamily="var(--font-geist-mono), monospace" fontSize="10" stroke="none" fill="currentColor">@#%*+=-.</text>
        <text x="24" y="44" fontFamily="var(--font-geist-mono), monospace" fontSize="10" stroke="none" fill="currentColor">#*@@@*+:</text>
        <text x="24" y="58" fontFamily="var(--font-geist-mono), monospace" fontSize="10" stroke="none" fill="currentColor">+*%#@%*=</text>
      </>
    ),
  },
  eye: {
    fill: <path d="M14 45Q60 8 106 45Q60 82 14 45Z" />,
    ink: (
      <>
        <path d="M6 45Q60 0 114 45Q60 90 6 45Z" strokeWidth="1" strokeDasharray="2 5" />
        <path d="M14 45Q60 8 106 45Q60 82 14 45Z" />
        <circle cx="60" cy="45" r="14" />
        <circle cx="60" cy="45" r="5" fill="currentColor" />
        <path d="M68 38L71 35" strokeWidth="1.4" />
      </>
    ),
  },
  projector: {
    fill: <path d="M69 52L112 22V86L69 64Z" />,
    ink: (
      <>
        <rect x="12" y="44" width="48" height="28" rx="4" />
        <circle cx="60" cy="58" r="9" />
        <circle cx="26" cy="41" r="5" />
        <circle cx="42" cy="41" r="5" />
        <path d="M69 52L112 22M69 64L112 86" strokeDasharray="4 4" />
        <path d="M112 20V88" />
        <path d="M20 72L16 82M52 72L56 82" />
      </>
    ),
  },
};

interface DoodleProps {
  id: DoodleId;
  hue: number;
  className?: string;
}

export function Doodle({ id, hue, className }: DoodleProps) {
  const art = ART[id];
  const pattern = `halftone-${id}`;
  return (
    <svg viewBox="0 0 120 90" className={className} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={pattern} width="4" height="4" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.25" fill={`hsl(${hue} 95% 52%)`} />
        </pattern>
      </defs>
      <g fill={`url(#${pattern})`} stroke="none" transform="translate(2.5 2)">
        {art.fill}
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {art.ink}
      </g>
    </svg>
  );
}
