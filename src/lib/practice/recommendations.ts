import {
  PRACTICE_SONGS,
  type PracticeArrangement,
  type PracticeGoal,
  type PracticeInstrument,
  type PracticeLevel,
  type PracticeSong,
} from "./catalog";

export type { PracticeGoal, PracticeInstrument, PracticeLevel } from "./catalog";

export interface SpotifyCandidate {
  id: string;
  name: string;
  artists: string[];
  url: string;
}

export interface PracticeOptions {
  instrument: PracticeInstrument;
  level: PracticeLevel;
  goal: PracticeGoal;
}

export interface PracticeRecommendation {
  track: SpotifyCandidate | null;
  catalog: PracticeSong | null;
  arrangement: PracticeArrangement | null;
  status: "matched" | "wrong-instrument" | "unassessed";
  fit: "play-now" | "stretch" | "goal" | "unassessed";
  reasons: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeTitle(value: string): string {
  // Ignore edition/credit suffixes, but preserve live/acoustic/remix distinctions.
  // Those can be different arrangements and should remain unassessed.
  let title = value.trim();
  for (let pass = 0; pass < 2; pass++) {
    title = title
      .replace(/(?:\s*[-–—]\s*|\s*\()(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?)(?:\))?$/i, "")
      .replace(/\s*\((?:feat\.?|ft\.?|featuring)\s+[^)]+\)$/i, "");
  }
  return normalize(title);
}

function matchSong(track: SpotifyCandidate): PracticeSong | null {
  const title = normalizeTitle(track.name);
  const artists = track.artists.map(normalize);
  return PRACTICE_SONGS.find((song) => normalizeTitle(song.title) === title
    && song.artistAliases.some((artist) => artists.includes(normalize(artist)))) ?? null;
}

const GOAL_NAMES: Record<Exclude<PracticeGoal, "any">, string> = {
  groove: "groove and timing", chords: "chord changes", riffs: "single-note riffs",
};

function assess(song: PracticeSong, track: SpotifyCandidate | null, options: PracticeOptions): PracticeRecommendation {
  const arrangement = song.arrangements[options.instrument] ?? null;
  if (!arrangement) return {
    track, catalog: song, arrangement: null, status: "wrong-instrument", fit: "unassessed",
    reasons: [`We have not assessed a ${options.instrument} section for this song.`],
  };
  const gap = arrangement.level - options.level;
  const fit = gap <= 0 ? "play-now" : gap === 1 ? "stretch" : "goal";
  const reasons = [gap <= 0
    ? "Within the comfort level you selected."
    : gap === 1 ? "One step beyond the comfort level you selected."
      : "Save for later; this section is two levels above your selected comfort level."];
  if (options.goal !== "any" && arrangement.goals.includes(options.goal)) {
    reasons.push(`Works on your ${GOAL_NAMES[options.goal]} goal.`);
  }
  reasons.push(arrangement.chartId ? "An exercise is available in the trainer." : "Use the linked guide; no scored chart is available yet.");
  return { track, catalog: song, arrangement, status: "matched", fit, reasons };
}

function sortForPractice(cards: PracticeRecommendation[], options: PracticeOptions): PracticeRecommendation[] {
  const buckets = { "play-now": 0, stretch: 1, goal: 2, unassessed: 3 };
  return cards.map((card, index) => ({ card, index })).sort((a, b) => {
    const bucket = buckets[a.card.fit] - buckets[b.card.fit];
    if (bucket) return bucket;
    const goalMatch = (card: PracticeRecommendation) => options.goal !== "any"
      && card.arrangement?.goals.includes(options.goal) ? 1 : 0;
    const goal = goalMatch(b.card) - goalMatch(a.card);
    if (goal) return goal;
    const distance = (card: PracticeRecommendation) => card.arrangement
      ? Math.abs(card.arrangement.level - options.level) : 0;
    return distance(a.card) - distance(b.card) || a.index - b.index;
  }).map(({ card }) => card);
}

/**
 * Match Spotify-supplied candidates to our own practice metadata, then sort by
 * the instrument, comfort level and goal the user explicitly chose. No plays,
 * popularity, audio analysis, inferred tastes, or ML inputs are used.
 */
export function recommendSongs(candidates: readonly SpotifyCandidate[], options: PracticeOptions): PracticeRecommendation[] {
  const seenTracks = new Set<string>();
  const cards: PracticeRecommendation[] = [];
  for (const track of candidates) {
    if (seenTracks.has(track.id)) continue;
    seenTracks.add(track.id);
    const song = matchSong(track);
    cards.push(song ? assess(song, track, options) : {
      track, catalog: null, arrangement: null, status: "unassessed", fit: "unassessed",
      reasons: ["No verified practice section yet; difficulty and instrument fit are unknown."],
    });
  }
  return sortForPractice(cards, options);
}

/** Starter exercises come from our catalog; they are not personalized listening recommendations. */
export function starterSongs(options: PracticeOptions): PracticeRecommendation[] {
  return sortForPractice(PRACTICE_SONGS.filter((song) => song.arrangements[options.instrument])
    .map((song) => assess(song, null, options)), options);
}
