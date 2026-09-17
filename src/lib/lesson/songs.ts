// Song charts: a chord loop with voicings per instrument, used by the song
// practice mode. Chord progressions are described in our own voicings.

import type { FingerName } from "@/lib/neck/fretHand";

export interface VoicingNote {
  /** String index, 0 = lowest-pitched string. */
  s: number;
  f: number;
  finger?: FingerName;
}

export interface ChordVoicing {
  id: string;
  name: string;
  /** Notes of the voicing, low to high. */
  notes: VoicingNote[];
  /** Practice order for arpeggiated scoring (indices into `notes`). */
  arpeggio?: number[];
  /** Root note for the bass part. */
  rootMidiPc: number;
}

export interface ChartBar {
  chordId: string;
  beats: number;
}

export interface SongSection {
  name: string;
  loop: ChartBar[];
  repeats: number;
}

export interface SongChart {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  beatsPerBar: number;
  key: string;
  notes: string;
  /** Voicings per instrument profile id. */
  voicings: Record<string, Record<string, ChordVoicing>>;
  /** Bass roots per chord id: [string, fret]. */
  sections: SongSection[];
}

/**
 * Justin Bieber – YUKON (SWAG, 2025). Key G minor, mid-tempo, a three-chord
 * vamp that loops for the whole song. Published analyses disagree on tempo
 * (96 vs 81 BPM) and bar counts, so both are adjustable in the UI. Voicings
 * are kept around the 3rd–7th frets so one hand position covers the loop,
 * which is also where the camera neck tracker is most reliable.
 */
export const YUKON: SongChart = {
  id: "yukon",
  title: "YUKON",
  artist: "Justin Bieber",
  bpm: 96,
  beatsPerBar: 4,
  key: "G minor",
  notes:
    "Live at the 2026 Grammys it was one electric guitar into a looper with MPC bass. Loop the vamp: C9sus4 → Dm7 → Gm. Keep it clean and let the Gm ring for two bars if the 4-bar loop feels right.",
  voicings: {
    "guitar-standard": {
      c9sus4: {
        id: "c9sus4",
        name: "C9sus4",
        notes: [
          { s: 1, f: 3, finger: "index" },
          { s: 2, f: 3, finger: "index" },
          { s: 3, f: 3, finger: "index" },
          { s: 4, f: 3, finger: "index" },
          { s: 5, f: 3, finger: "index" },
        ],
        arpeggio: [0, 1, 2, 3, 4],
        rootMidiPc: 0,
      },
      dm7: {
        id: "dm7",
        name: "Dm7",
        notes: [
          { s: 1, f: 5, finger: "index" },
          { s: 2, f: 7, finger: "ring" },
          { s: 3, f: 5, finger: "index" },
          { s: 4, f: 6, finger: "middle" },
          { s: 5, f: 5, finger: "index" },
        ],
        arpeggio: [0, 1, 2, 3, 4],
        rootMidiPc: 2,
      },
      gm: {
        id: "gm",
        name: "Gm",
        notes: [
          { s: 0, f: 3, finger: "index" },
          { s: 1, f: 5, finger: "ring" },
          { s: 2, f: 5, finger: "pinky" },
          { s: 3, f: 3, finger: "index" },
          { s: 4, f: 3, finger: "index" },
          { s: 5, f: 3, finger: "index" },
        ],
        arpeggio: [0, 1, 2, 3, 4, 5],
        rootMidiPc: 7,
      },
    },
    "bass-standard": {
      c9sus4: { id: "c9sus4", name: "C", notes: [{ s: 1, f: 3, finger: "index" }, { s: 2, f: 5, finger: "ring" }], arpeggio: [0, 1], rootMidiPc: 0 },
      dm7: { id: "dm7", name: "D", notes: [{ s: 1, f: 5, finger: "index" }, { s: 2, f: 7, finger: "ring" }], arpeggio: [0, 1], rootMidiPc: 2 },
      gm: { id: "gm", name: "G", notes: [{ s: 0, f: 3, finger: "index" }, { s: 1, f: 5, finger: "ring" }], arpeggio: [0, 1], rootMidiPc: 7 },
    },
  },
  sections: [
    {
      name: "Vamp",
      loop: [
        { chordId: "c9sus4", beats: 4 },
        { chordId: "dm7", beats: 4 },
        { chordId: "gm", beats: 4 },
      ],
      repeats: 0, // 0 = loop forever
    },
  ],
};

export const SONGS: SongChart[] = [YUKON];

/** Rebuild the chart with a different number of bars per chord (1 or 2). */
export function withBarsPerChord(chart: SongChart, bars: number): SongChart {
  return {
    ...chart,
    sections: chart.sections.map((sec) => ({
      ...sec,
      loop: sec.loop.map((b) => ({ ...b, beats: chart.beatsPerBar * bars })),
    })),
  };
}
