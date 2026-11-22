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
  keyLabel?: string;
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
    guitarFocus: "Keep time as you move into and out of barre shapes.",
    bassFocus: "Keep the root and fifth clear through each change.",
  },
  {
    id: "advanced", label: "Advanced", bpm: 80,
    guitarFocus: "Keep each barre clear as you shift along the neck.",
    bassFocus: "Play the root, fifth and tenth while muting the skipped string.",
  },
];

const TRIADS = {
  A: { root: 9, quality: "major" },
  Am: { root: 9, quality: "minor" },
  B: { root: 11, quality: "major" },
  "B♭": { root: 10, quality: "major" },
  Bm: { root: 11, quality: "minor" },
  C: { root: 0, quality: "major" },
  Cm: { root: 0, quality: "minor" },
  "C♯m": { root: 1, quality: "minor" },
  D: { root: 2, quality: "major" },
  Dm: { root: 2, quality: "minor" },
  E: { root: 4, quality: "major" },
  "E♭": { root: 3, quality: "major" },
  Em: { root: 4, quality: "minor" },
  F: { root: 5, quality: "major" },
  Fm: { root: 5, quality: "minor" },
  "F♯m": { root: 6, quality: "minor" },
  G: { root: 7, quality: "major" },
  Gm: { root: 7, quality: "minor" },
  "G♯": { root: 8, quality: "major" },
  "A♭": { root: 8, quality: "major" },
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
    id: "sweet-home-alabama", level: "easy",
    title: "Sweet Home Alabama", artist: "Lynyrd Skynyrd",
    section: "Verse groove", practiceKey: 7,
    chart: [step("D", "V", 2), step("C", "IV", 2), step("G", "I", 4)],
    arrangement: "Play D and C for two beats each, then settle on G for a full bar. The open-chord accompaniment follows the picking riff’s changes.",
    sourceLabel: "Lauren Bateman lesson",
    sourceUrl: "https://www.laurenbateman.com/sweet-home-alabama-chord-chart/",
    listenUrl: "https://music.apple.com/us/song/sweet-home-alabama/1440846819",
  },
  {
    id: "zombie", level: "easy",
    title: "Zombie", artist: "The Cranberries",
    section: "Verse loop", practiceKey: 4, keyLabel: "E minor",
    chart: [step("Em", "i", 4), step("C", "♭VI", 4), step("G", "♭III", 4), step("D", "♭VII", 4)],
    arrangement: "Give each chord a full bar. This root-position exercise plays D in the bass on the last bar. The lesson uses D over F♯ there.",
    sourceLabel: "Lauren Bateman lesson",
    sourceUrl: "https://www.laurenbateman.com/zombie-chord-chart/",
    listenUrl: "https://music.apple.com/us/song/zombie-2025-remastered/1828830887",
  },
  {
    id: "knockin-on-heavens-door", level: "easy",
    title: "Knockin’ on Heaven’s Door", artist: "Bob Dylan",
    section: "Verse changes", practiceKey: 7,
    chart: [step("G", "I", 2), step("D", "V", 2), step("Am", "ii", 4),
            step("G", "I", 2), step("D", "V", 2), step("C", "IV", 4)],
    arrangement: "Start both phrases with G and D. The first lands on A minor and the second on C. Let each landing ring for four beats.",
    sourceLabel: "Lauren Bateman lesson",
    sourceUrl: "https://www.laurenbateman.com/knockin-on-heavens-door-guitar-chord-char",
    listenUrl: "https://music.apple.com/us/song/knockin-on-heavens-door/717157149",
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
    id: "go-your-own-way", level: "intermediate",
    title: "Go Your Own Way", artist: "Fleetwood Mac",
    section: "Chorus loop", practiceKey: 5,
    chart: [step("Dm", "vi", 4), step("B♭", "IV", 4), step("C", "V", 8)],
    arrangement: "Start the chorus on D minor, change to B♭ for one bar and hold C for two. Count through the second bar of C before returning to D minor.",
    sourceLabel: "Spy Tunes lesson",
    sourceUrl: "https://spytunes.com/go-your-own-way-chords/",
    listenUrl: "https://music.apple.com/us/song/go-your-own-way/594061859",
  },
  {
    id: "valerie", level: "intermediate",
    title: "Valerie", artist: "Mark Ronson feat. Amy Winehouse",
    section: "Bridge", practiceKey: 3,
    chart: [step("A♭", "IV", 4), step("Gm", "iii", 4), step("A♭", "IV", 4), step("Gm", "iii", 4),
            step("A♭", "IV", 4), step("Gm", "iii", 4), step("B♭", "V", 8)],
    arrangement: "Alternate A♭ and G minor three times, moving the root down a fret each time. Hold the final B♭ for two bars to lead into the chorus.",
    sourceLabel: "Spy Tunes lesson",
    sourceUrl: "https://spytunes.com/valerie-chords/",
    listenUrl: "https://music.apple.com/us/song/valerie-feat-amy-winehouse/259214627",
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
  {
    id: "get-lucky", level: "advanced",
    title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams & Nile Rodgers",
    section: "Verse loop", practiceKey: 11, keyLabel: "B Dorian",
    chart: [step("Bm", "i", 4), step("D", "♭III", 4), step("F♯m", "v", 4), step("E", "IV", 4)],
    arrangement: "Place a chord on beat one of each bar. Once the shifts feel steady, shorten your strums and listen for the clipped guitar rhythm on the recording.",
    sourceLabel: "Spy Tunes lesson",
    sourceUrl: "https://spytunes.com/get-lucky-chords/",
    listenUrl: "https://music.apple.com/us/song/get-lucky/617154366",
  },
  {
    id: "blinding-lights", level: "advanced",
    title: "Blinding Lights", artist: "The Weeknd",
    section: "Synth hook accompaniment", practiceKey: 3,
    chart: [step("Fm", "ii", 8), step("Cm", "vi", 8), step("E♭", "I", 8), step("B♭", "V", 8)],
    arrangement: "Let the synth carry the melody while you count two bars per chord. The numerals follow the lesson’s E♭ major reading of the loop.",
    sourceLabel: "Paul Burke guitar lesson",
    sourceUrl: "https://colchesterguitarteacher.com/2020/05/20/guitar-lesson-how-to-play-blinding-lights-by-the-weeknd-chords-tab/",
    listenUrl: "https://music.apple.com/us/song/blinding-lights/1615128020",
  },
  {
    id: "levitating", level: "advanced",
    title: "Levitating", artist: "Dua Lipa",
    section: "Verse loop", practiceKey: 11, keyLabel: "B minor",
    chart: [step("Bm", "i", 2), step("F♯m", "v", 2), step("Em", "iv", 2), step("Bm", "i", 2)],
    arrangement: "Change on beats one and three. This triad arrangement keeps the roots and minor quality of the verse’s seventh chords. Let the last B minor carry you into the repeat.",
    sourceLabel: "Spy Tunes lesson",
    sourceUrl: "https://spytunes.com/levitating-chords/",
    listenUrl: "https://music.apple.com/us/song/levitating/1538003843",
  },
];
