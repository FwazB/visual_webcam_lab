import { BASS_STANDARD, GUITAR_STANDARD, midiAt, type InstrumentProfile } from "@/lib/instrument/profile";
import { getSongChord, type Chord, type Instrument } from "./music";

const LETTERS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const mod12 = (pitch: number) => ((pitch % 12) + 12) % 12;

// Intervals in chord-name order. Here 9 semitones denotes a diminished seventh,
// and 14 an added ninth. Keeping those identities gives e.g. Cdim7 its B♭♭.
const LETTER_OFFSET: Record<number, number> = {
  0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 6, 10: 6, 11: 6, 14: 1,
};
const INTERVALS = new Map<string, number[]>([
  ["5", [0, 7]], ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]],
  ["7", [0, 4, 7, 10]], ["maj7", [0, 4, 7, 11]], ["m7", [0, 3, 7, 10]],
  ["add9", [0, 4, 7, 14]], ["madd9", [0, 3, 7, 14]],
  ["7sus2", [0, 2, 7, 10]], ["7sus4", [0, 5, 7, 10]],
  ["dim", [0, 3, 6]], ["dim7", [0, 3, 6, 9]], ["m7b5", [0, 3, 6, 10]],
  ["aug", [0, 4, 8]], ["mmaj7", [0, 3, 7, 11]],
]);
const ALIASES = new Map([
  ["maj", ""], ["M", ""], ["min", "m"], ["min7", "m7"], ["M7", "maj7"],
  ["no3d", "5"], ["no3", "5"], ["sus", "sus4"], ["7sus", "7sus4"],
  ["minadd9", "madd9"], ["minmaj7", "mmaj7"], ["m7♭5", "m7b5"],
]);

function noteName(rootLetter: number, root: number, interval: number) {
  const letter = (rootLetter + LETTER_OFFSET[interval]) % 7;
  const difference = mod12(root + interval - NATURALS[letter] + 6) - 6;
  return LETTERS[letter] + (difference < 0 ? "♭" : "♯").repeat(Math.abs(difference));
}

function soundingIntervals(intervals: number[], instrument: Instrument) {
  if (intervals.length === 2) return [0, 7, instrument === "guitar" ? 12 : null, null];
  const [, color, fifth, extension] = intervals;
  if (extension === 14) return [0, color, fifth, 14];
  // A seventh sits between the fifth and the upper third (or suspension).
  // Guitar triads double the root there. Bass triads skip that string.
  return [0, fifth, extension ?? (instrument === "guitar" ? 12 : null), color + 12];
}

type Frets = (number | null)[];

function findFrets(profile: InstrumentProfile, root: number, pitches: Frets, instrument: Instrument): Frets | null {
  let best: Frets | null = null;
  let bestTop = Infinity;
  // Move the same intervals among guitar's E, A and D root strings. On bass,
  // keep four-note harmony in a clear register with the root on the E string.
  for (let first = 0; first <= profile.stringCount - pitches.length; first++) {
    for (let anchor = mod12(root - profile.tuning[first]); anchor <= profile.fretCount; anchor += 12) {
      if (instrument === "bass" && anchor < 5) continue;
      const rootMidi = midiAt(profile, first, anchor);
      const frets: Frets = profile.tuning.map(() => null);
      pitches.forEach((interval, offset) => {
        if (interval !== null) frets[first + offset] = rootMidi + interval - profile.tuning[first + offset];
      });
      const played = frets.filter((fret): fret is number => fret !== null);
      if (played.some(fret => fret < 0 || fret > profile.fretCount)) continue;
      const stopped = played.filter(fret => fret > 0);
      const top = Math.max(0, ...stopped);
      if (top - Math.min(...stopped) <= 3 && top < bestTop) {
        best = frets;
        bestTop = top;
      }
    }
  }
  return best;
}

// A barre can cross strings fretted above it. An open, lower or skipped
// string breaks the barre and needs a separate finger on the other side.
function assignFingers(frets: Frets) {
  const groups: { fret: number; strings: number[] }[] = [];
  for (const [index, fret] of frets.entries()) {
    if (fret === null || fret === 0) continue;
    const previous = groups.find(group => group.fret === fret &&
      frets.slice(group.strings[0], index).every(other => other !== null && other >= fret));
    if (previous) previous.strings.push(index);
    else groups.push({ fret, strings: [index] });
  }
  // The diagram supports one barre. Use separate fingers for any other group.
  const longest = groups.reduce<(typeof groups)[number] | undefined>((best, group) =>
    group.strings.length > (best?.strings.length ?? 1) ? group : best, undefined);
  const placements = groups.flatMap(group => group === longest ? [group] :
    group.strings.map(index => ({ fret: group.fret, strings: [index] })));
  placements.sort((a, b) => a.fret - b.fret || a.strings[0] - b.strings[0]);
  const fingers: (number | null)[] = frets.map(() => null);
  let barre: Chord["barre"];
  let finger = 0;
  for (const [index, group] of placements.entries()) {
    const preferred = group.fret - placements[0].fret + 1;
    finger = Math.min(5 - placements.length + index, Math.max(finger + 1, preferred));
    for (const string of group.strings) fingers[string] = finger;
    if (group === longest) {
      barre = { fret: group.fret, from: group.strings[0], to: group.strings[group.strings.length - 1], finger };
    }
  }
  return { fingers, barre };
}

export function publishedFingering(symbol: string, instrument: Instrument): Chord | null {
  const match = /^([A-G])([#♯b♭]?)([^\s/]*)$/.exec(symbol);
  if (!match || match[0] !== symbol) return null;
  const [, letter, accidental, suffix] = match;
  const rootLetter = LETTERS.indexOf(letter);
  const delta = accidental === "♯" || accidental === "#" ? 1 : accidental ? -1 : 0;
  const root = mod12(NATURALS[rootLetter] + delta);
  const quality = ALIASES.get(suffix) ?? suffix;
  if (quality === "" || quality === "m") {
    return getSongChord({ name: symbol, root, quality: quality === "m" ? "minor" : "major", numeral: "" },
      instrument, "advanced");
  }
  const intervals = INTERVALS.get(quality);
  if (!intervals) return null;
  const profile = instrument === "bass" ? BASS_STANDARD : GUITAR_STANDARD;
  const frets = findFrets(profile, root, soundingIntervals(intervals, instrument), instrument);
  if (!frets) return null;
  const { fingers, barre } = assignFingers(frets);
  return {
    name: symbol, numeral: "", notes: intervals.map(interval => noteName(rootLetter, root, interval)),
    strings: frets.map((fret, index) => ({
      fret, finger: fingers[index], midi: fret === null ? null : midiAt(profile, index, fret),
    })),
    ...(barre && { barre }),
  };
}
