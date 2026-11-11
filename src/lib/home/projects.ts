// Six familiar guitar strings plus a virtual low A for Pocket Operators.
import { GUITAR_STANDARD } from "@/lib/instrument/profile";

export type DoodleId = "guitar" | "bass" | "cassette" | "headphones" | "ascii" | "eye" | "projector";

export interface Project {
  id: string;
  title: string;
  blurb: string;
  href: string;
  /** Opens outside the app (TouchDesigner projects on GitHub). */
  external: boolean;
  doodle: DoodleId;
  /** Pitch class that colors the card; the string's pitch for strung projects. */
  pitchClass: number;
}

const REPO = "https://github.com/FwazB/visual_webcam_lab/tree/main";

export interface StringProject extends Project {
  stringLabel: string;
  midi: number;
  gauge: number;
  voice: "pluck" | "cloud";
}

const GUITAR_PROJECTS: Project[] = [
  {
    id: "guitar",
    title: "Guitar trainer",
    blurb: "Shapes and a song, scored from what you actually play through the Spark pedal.",
    href: "/guitar",
    external: false,
    doodle: "guitar",
    pitchClass: 4,
  },
  {
    id: "bass",
    title: "Bass trainer",
    blurb: "The same trainer, set up for four strings.",
    href: "/bass",
    external: false,
    doodle: "bass",
    pitchClass: 9,
  },
  {
    id: "studio",
    title: "Studio",
    blurb: "Record takes over a click, stack and trim them, export a WAV.",
    href: "/studio",
    external: false,
    doodle: "cassette",
    pitchClass: 2,
  },
  {
    id: "for-you",
    title: "For you",
    blurb: "Practice picks matched to your Spotify top tracks.",
    href: "/for-you",
    external: false,
    doodle: "headphones",
    pitchClass: 7,
  },
  {
    id: "ascii",
    title: "ASCII camera",
    blurb: "Your webcam as text, with you picked out of the room.",
    href: "/ascii",
    external: false,
    doodle: "ascii",
    pitchClass: 11,
  },
  {
    id: "fuzz",
    title: "Fuzz",
    blurb: "Camera feedback colored by the note you play. E is yellow, A is green.",
    href: `${REPO}/touchdesigner/fuzz`,
    external: true,
    doodle: "eye",
    pitchClass: 4,
  },
];

/** The virtual string is homepage navigation, not a change to trainer tuning. */
export const STRUNG_PROJECTS: StringProject[] = [
  ...GUITAR_PROJECTS.map((project, index): StringProject => ({
    ...project,
    stringLabel: GUITAR_STANDARD.stringLabels[index],
    midi: GUITAR_STANDARD.tuning[index],
    gauge: [3.4, 2.9, 2.4, 2, 1.6, 1.3][index],
    voice: "pluck",
  })),
  {
    id: "pocket-operators",
    title: "Pocket Operators",
    blurb: "Make a beat on Rhythm, sample with K.O., and find your way into the studio.",
    href: "/pocket-operators",
    external: false,
    doodle: "cassette",
    pitchClass: 9,
    stringLabel: "A",
    midi: 33,
    gauge: 2.5,
    voice: "cloud",
  },
];

export const PROJECTS: Project[] = [
  ...STRUNG_PROJECTS,
  {
    id: "projection-mapping",
    title: "Projection mapping",
    blurb: "Corner-pin Fuzz, or just its light, onto a real wall.",
    href: `${REPO}/touchdesigner/projection_mapping`,
    external: true,
    doodle: "projector",
    pitchClass: 0,
  },
];
