export type PracticeInstrument = "guitar" | "bass";
export type PracticeLevel = 1 | 2 | 3;
export type PracticeGoal = "any" | "groove" | "chords" | "riffs";

export interface PracticeArrangement {
  /** Our rough estimate for this section, not a grade for the entire song. */
  level: PracticeLevel;
  section: string;
  focus: string;
  techniques: string[];
  goals: Exclude<PracticeGoal, "any">[];
  sourceUrl: string;
  sourceLabel: string;
  /** Only set when the trainer actually contains a chart for this arrangement. */
  chartId?: string;
}

export interface PracticeSong {
  id: string;
  title: string;
  artist: string;
  artistAliases: string[];
  arrangements: Partial<Record<PracticeInstrument, PracticeArrangement>>;
}

const BASSBUZZ = "https://www.bassbuzz.com/lessons/25-bass-tabs-that-rule";

// Independently written practice suggestions, with educator guides for reference.
// These estimates describe the named exercise, never Spotify audio or a full song.
// No tabs, lyrics, tempo/key guesses, or Spotify listening profiles are stored here.
export const PRACTICE_SONGS: PracticeSong[] = [
  {
    id: "yukon", title: "YUKON", artist: "Justin Bieber", artistAliases: ["Justin Bieber"],
    arrangements: {
      guitar: {
        level: 2, section: "Trainer chord loop", goals: ["chords", "groove"],
        focus: "Pick each chord tone clearly, then connect the three shapes without rushing.",
        techniques: ["Chord changes", "Arpeggios", "Barre shapes"],
        sourceUrl: "https://www.youtube.com/watch?v=1I274Gd92PI", sourceLabel: "Lachlan Thomson guitar guide",
        chartId: "yukon",
      },
      bass: {
        level: 1, section: "Trainer root-and-fifth exercise", goals: ["groove", "riffs"],
        focus: "Use the trainer's simplified roots and fifths to keep an even pulse through the loop.",
        techniques: ["Roots and fifths", "Steady timing"],
        sourceUrl: "/bass", sourceLabel: "Our simplified trainer exercise", chartId: "yukon",
      },
    },
  },
  {
    id: "aint-no-sunshine", title: "Ain't No Sunshine", artist: "Bill Withers", artistAliases: ["Bill Withers"],
    arrangements: { guitar: {
      level: 1, section: "Simplified chord accompaniment", goals: ["chords", "groove"],
      focus: "Keep a quiet, steady strum while making clean minor-chord changes.",
      techniques: ["Minor chords", "Steady strumming"],
      sourceUrl: "https://www.youtube.com/watch?v=kYEO1wgFqFY", sourceLabel: "JustinGuitar lesson",
    } },
  },
  {
    id: "stand-by-me", title: "Stand By Me", artist: "Ben E. King", artistAliases: ["Ben E. King"],
    arrangements: {
      guitar: {
        level: 1, section: "Beginner chord accompaniment", goals: ["chords", "groove"],
        focus: "Make the repeating chord changes feel even before adding backbeat accents.",
        techniques: ["Open chords", "Backbeat"],
        sourceUrl: "https://www.justinguitar.com/songs/ben-e-king-stand-by-me-chords-tabs-guitar-lesson-bs-323", sourceLabel: "JustinGuitar lesson",
      },
      bass: {
        level: 2, section: "Main bass pattern", goals: ["groove", "riffs"],
        focus: "Keep the bouncy pattern relaxed and place every note consistently.",
        techniques: ["Note placement", "Repeating groove"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
      },
    },
  },
  {
    id: "best-part", title: "Best Part", artist: "Daniel Caesar, H.E.R.", artistAliases: ["Daniel Caesar", "H.E.R."],
    arrangements: { guitar: {
      level: 2, section: "Chord accompaniment", goals: ["chords", "groove"],
      focus: "Learn the accompaniment slowly, then make the chord transitions sound unbroken.",
      techniques: ["Chord voicings", "Controlled accompaniment"],
      sourceUrl: "https://www.youtube.com/watch?v=A05Z40PTqgw", sourceLabel: "Marty Music lesson",
    } },
  },
  {
    id: "pink-white", title: "Pink + White", artist: "Frank Ocean", artistAliases: ["Frank Ocean"],
    arrangements: { guitar: {
      level: 2, section: "Verse and chorus accompaniment", goals: ["chords"],
      focus: "Work on the verse and chorus accompaniment first, then learn the intro separately.",
      techniques: ["Chord changes", "Section transitions"],
      sourceUrl: "https://www.youtube.com/watch?v=dsOtOLR23pg", sourceLabel: "Gautier Guitar lesson",
    } },
  },
  {
    id: "get-lucky", title: "Get Lucky", artist: "Daft Punk", artistAliases: ["Daft Punk"],
    arrangements: { guitar: {
      level: 3, section: "Funk rhythm guitar", goals: ["groove", "chords"],
      focus: "Practice small chord shapes and slow sixteenth-note strumming before increasing speed.",
      techniques: ["Small barre voicings", "Sixteenth-note rhythm"],
      sourceUrl: "https://yourguitaracademy.com/courses/nile-rogers/lessons/get-lucky-guitar-lesson", sourceLabel: "Your Guitar Academy lesson",
    } },
  },
  {
    id: "feel-good-inc", title: "Feel Good Inc.", artist: "Gorillaz", artistAliases: ["Gorillaz"],
    arrangements: { bass: {
      level: 2, section: "Main bass riff", goals: ["groove", "riffs"],
      focus: "Hum the syncopated rhythm, then keep the spaces between notes deliberate. The guide uses half-step-down tuning for the recording.",
      techniques: ["Syncopation", "Note spacing"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
    } },
  },
  {
    id: "another-one-bites-the-dust", title: "Another One Bites The Dust", artist: "Queen", artistAliases: ["Queen"],
    arrangements: { bass: {
      level: 1, section: "Main bass riff", goals: ["groove", "riffs"],
      focus: "Start slowly and keep the brief notes as controlled as the longer ones.",
      techniques: ["Note length", "Repeated-note groove"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
    } },
  },
  {
    id: "psycho-killer", title: "Psycho Killer", artist: "Talking Heads", artistAliases: ["Talking Heads", "The Talking Heads"],
    arrangements: { bass: {
      level: 1, section: "Main bass riff", goals: ["groove", "riffs"],
      focus: "Make the repeated notes short and consistent, then give the change a clear accent.",
      techniques: ["Short notes", "Accents"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
    } },
  },
  {
    id: "billie-jean", title: "Billie Jean", artist: "Michael Jackson", artistAliases: ["Michael Jackson"],
    arrangements: { bass: {
      level: 3, section: "Main bass pattern", goals: ["groove", "riffs"],
      focus: "Keep the repeating pattern accurate for a short loop before building endurance.",
      techniques: ["Stamina", "Consistent timing", "Finger coordination"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
    } },
  },
  {
    id: "seven-nation-army", title: "Seven Nation Army", artist: "The White Stripes", artistAliases: ["The White Stripes", "White Stripes"],
    arrangements: {
      guitar: {
        level: 1, section: "Beginner single-note riff", goals: ["riffs", "groove"],
        focus: "Keep the single-string riff clear while muting the strings you are not playing.",
        techniques: ["Single-note picking", "String muting", "Position shifts"],
        sourceUrl: "https://www.justinguitar.com/guitar-lessons/seven-nation-army-b1-309", sourceLabel: "JustinGuitar beginner riff lesson",
      },
      bass: {
        level: 1, section: "Bass adaptation of the main riff", goals: ["riffs", "groove"],
        focus: "Stay relaxed while shifting along the neck and keep the riff's pulse steady.",
        techniques: ["Position shifts", "Single-note groove"], sourceUrl: BASSBUZZ, sourceLabel: "BassBuzz riff guide",
      },
    },
  },
];
