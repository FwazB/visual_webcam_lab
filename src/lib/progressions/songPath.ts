export type LevelId = "easy" | "intermediate" | "advanced";

export interface SongStep {
  name: string;
  root: number;
  quality: "major" | "minor";
  numeral: string;
  beats: number;
}

export interface SongLesson {
  id: string;
  level: LevelId;
  title: string;
  artist: string;
  section: string;
  practiceKey: number;
  chart: SongStep[];
  arrangement: string;
  sourceLabel: string;
  sourceUrl: string;
  listenUrl: string;
}

export const LEVELS: {
  id: LevelId;
  label: string;
  bpm: number;
  guitarFocus: string;
  bassFocus: string;
}[] = [
  {
    id: "easy", label: "Easy", bpm: 60,
    guitarFocus: "Change between open chords on the beat.",
    bassFocus: "Find each chord’s root and let it ring.",
  },
  {
    id: "intermediate", label: "Intermediate", bpm: 72,
    guitarFocus: "Connect four chord shapes, including a barre.",
    bassFocus: "Keep the root and fifth clear through each change.",
  },
  {
    id: "advanced", label: "Advanced", bpm: 80,
    guitarFocus: "Shift cleanly between major and minor barre shapes.",
    bassFocus: "Play the root, fifth and tenth while muting the skipped string.",
  },
];

const TRIADS = {
  A: { root: 9, quality: "major" },
  Am: { root: 9, quality: "minor" },
  B: { root: 11, quality: "major" },
  C: { root: 0, quality: "major" },
  Cm: { root: 0, quality: "minor" },
  "C♯m": { root: 1, quality: "minor" },
  D: { root: 2, quality: "major" },
  E: { root: 4, quality: "major" },
  F: { root: 5, quality: "major" },
  "F♯m": { root: 6, quality: "minor" },
  G: { root: 7, quality: "major" },
  "G♯": { root: 8, quality: "major" },
} as const;

function step(name: keyof typeof TRIADS, numeral: string, beats: number): SongStep {
  return { name, ...TRIADS[name], numeral, beats };
}

// Quarter-note durations describe the named excerpt. Tempos above are practice settings.
export const SONGS: SongLesson[] = [
  {
    id: "three-little-birds", level: "easy",
    title: "Three Little Birds", artist: "Bob Marley & the Wailers",
    section: "Opening refrain", practiceKey: 9,
    chart: [step("A", "I", 8), step("D", "IV", 4), step("A", "I", 4)],
    arrangement: "Count two bars on the first A. This slow accompaniment leaves space to add the reggae offbeats yourself.",
    sourceLabel: "Your Guitar Academy lesson",
    sourceUrl: "https://www.guitarclub.io/blog/three-little-birds-guitar-lesson-bob-marley",
    listenUrl: "https://music.apple.com/us/song/three-little-birds/1629115759",
  },
  {
    id: "bad-moon-rising", level: "easy",
    title: "Bad Moon Rising", artist: "Creedence Clearwater Revival",
    section: "Verse phrase", practiceKey: 2,
    chart: [step("D", "I", 4), step("A", "V", 2), step("G", "IV", 2), step("D", "I", 8)],
    arrangement: "A and G split one bar. Land back on D and count two full bars before restarting the phrase.",
    sourceLabel: "Lauren Bateman lesson",
    sourceUrl: "https://www.laurenbateman.com/bad-moon-rising-chord-chart/",
    listenUrl: "https://music.apple.com/us/song/bad-moon-rising/1440952840",
  },
  {
    id: "stand-by-me", level: "intermediate",
    title: "Stand By Me", artist: "Ben E. King",
    section: "Verse loop", practiceKey: 9,
    chart: [step("A", "I", 8), step("F♯m", "vi", 8), step("D", "IV", 4),
            step("E", "V", 4), step("A", "I", 8)],
    arrangement: "Play in the recording’s key of A without a capo. The bass exercise outlines the chords and leaves out the signature walking line.",
    sourceLabel: "JustinGuitar lesson",
    sourceUrl: "https://www.justinguitar.com/songs/ben-e-king-stand-by-me-chords-tabs-guitar-lesson-bs-323",
    listenUrl: "https://music.apple.com/us/song/stand-by-me/68210790",
  },
  {
    id: "let-it-be", level: "intermediate",
    title: "Let It Be", artist: "The Beatles",
    section: "Verse opening", practiceKey: 0,
    chart: [step("C", "I", 2), step("G", "V", 2), step("Am", "vi", 2), step("F", "IV", 2)],
    arrangement: "Loop the first two bars of the verse. Change on beats one and three, then return to C.",
    sourceLabel: "Your Guitar Academy lesson",
    sourceUrl: "https://www.guitarclub.io/blog/let-it-be-the-beatles-guitar-lesson-chords",
    listenUrl: "https://music.apple.com/us/song/let-it-be/1441164738",
  },
  {
    id: "creep", level: "advanced",
    title: "Creep", artist: "Radiohead",
    section: "Chorus loop", practiceKey: 7,
    chart: [step("G", "I", 8), step("B", "III", 8), step("C", "IV", 8), step("Cm", "iv", 8)],
    arrangement: "Hold each chord for two bars. Listen for E dropping to E♭ as C becomes Cm before the return to G.",
    sourceLabel: "Fender Play chorus lesson",
    sourceUrl: "https://www.fender.com/play/lessons/creep-chorus-rhythm-guitar",
    listenUrl: "https://music.apple.com/us/song/creep/1097862231",
  },
  {
    id: "where-is-my-mind", level: "advanced",
    title: "Where Is My Mind?", artist: "Pixies",
    section: "Opening chord loop", practiceKey: 4,
    chart: [step("E", "I", 2), step("C♯m", "vi", 2), step("G♯", "III", 2), step("A", "IV", 2)],
    arrangement: "Give each chord half a bar. This version puts C♯ in the bass of C♯ minor. The lesson’s inverted grip has G♯ underneath.",
    sourceLabel: "JustinGuitar lesson",
    sourceUrl: "https://www.justinguitar.com/songs/pixies-where-is-my-mind-chords-tabs-guitar-lesson-sg-198",
    listenUrl: "https://music.apple.com/us/song/where-is-my-mind-2007-remaster/1027465608",
  },
];
