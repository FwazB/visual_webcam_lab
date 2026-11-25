export const sessions = {
  rhythm: {
    title: "PO-12 Rhythm",
    focus: "Build a drum pattern",
    description: "Place a kick, snare and hi-hat across sixteen steps. Change one hit and hear what it does to the groove.",
  },
  ko: {
    title: "PO-33 K.O!",
    focus: "Play a sound you recorded",
    description: "Record your voice, trim the start and turn one syllable into a repeating accent.",
  },
  factory: {
    title: "PO-16 Factory",
    focus: "Write a melody",
    description: "Make a three-note phrase, change its shape and leave the last beat open.",
  },
  combined: {
    title: "All three together",
    focus: "Play a combined set",
    description: "Bring your drum pattern, melody and sampled accent into the same bar. Rhythm will keep time for all three.",
  },
};

export type Session = keyof typeof sessions;
export const sessionOrder: readonly Session[] = ["rhythm", "ko", "factory", "combined"];

export function sessionHref(id: Session) {
  return `/pocket-operators/${id}`;
}
