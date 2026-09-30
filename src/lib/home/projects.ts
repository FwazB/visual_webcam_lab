// Everything the homepage lists. The first six ride a guitar string each,
// in standard-tuning order (low E first).

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

/** One project per string, low E to high e. */
export const STRUNG_PROJECTS: Project[] = [
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
