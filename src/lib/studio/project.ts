// Studio project model: tracks, clips on a timeline in seconds, and the pure
// edit operations the timeline uses. Audio data lives outside the project,
// referenced by `bufferId`, so edits and undo never copy samples.

export interface Track {
  id: string;
  name: string;
  color: string;
  /** Linear gain, 0..1.5. */
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  bufferId: string;
  name: string;
  /** Timeline position of the clip's first audible sample (s). */
  start: number;
  /** Seconds skipped at the start of the buffer. */
  offset: number;
  /** Audible length (s). */
  duration: number;
}

export interface Project {
  bpm: number;
  beatsPerBar: number;
  tracks: Track[];
  clips: Clip[];
}

/** Shortest clip an edit may leave (s). */
export const MIN_CLIP = 0.05;

export const TRACK_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171", "#2dd4bf"];

export function emptyProject(): Project {
  return { bpm: 96, beatsPerBar: 4, tracks: [], clips: [] };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function makeTrack(project: Project, name?: string): Track {
  const n = project.tracks.length;
  return {
    id: newId(),
    name: name ?? `Track ${n + 1}`,
    color: TRACK_COLORS[n % TRACK_COLORS.length],
    volume: 1,
    muted: false,
    solo: false,
  };
}

export function secondsPerBeat(project: Pick<Project, "bpm">): number {
  return 60 / project.bpm;
}

/** Round to the nearest beat subdivision (division 1 = beats, 4 = sixteenths). */
export function snap(t: number, bpm: number, division = 1): number {
  const step = 60 / bpm / division;
  return Math.round(t / step) * step;
}

export function projectEnd(project: Project): number {
  return project.clips.reduce((end, c) => Math.max(end, c.start + c.duration), 0);
}

/** Output gain of a track after mute and solo. */
export function effectiveGain(track: Track, anySolo: boolean): number {
  if (track.muted || (anySolo && !track.solo)) return 0;
  return track.volume;
}

export function anySolo(project: Project): boolean {
  return project.tracks.some((t) => t.solo);
}

/** "bar.beat" (1-based) and mm:ss.t for a timeline position. */
export function formatPosition(t: number, bpm: number, beatsPerBar: number): { bars: string; clock: string } {
  const beats = Math.floor(Math.max(0, t) / (60 / bpm) + 1e-6);
  const bar = Math.floor(beats / beatsPerBar) + 1;
  const beat = (beats % beatsPerBar) + 1;
  const s = Math.max(0, t);
  const clock = `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return { bars: `${bar}.${beat}`, clock };
}

/**
 * Place a recorded take whose first sample belongs at `start` (after latency
 * compensation). Audio before the timeline origin is trimmed off.
 */
export function placeTake(start: number, duration: number): { start: number; offset: number; duration: number } {
  if (start >= 0) return { start, offset: 0, duration };
  return { start: 0, offset: -start, duration: Math.max(0, duration + start) };
}

function mapClip(project: Project, id: string, fn: (c: Clip) => Clip): Project {
  return { ...project, clips: project.clips.map((c) => (c.id === id ? fn(c) : c)) };
}

export function addTrack(project: Project, track: Track): Project {
  return { ...project, tracks: [...project.tracks, track] };
}

export function removeTrack(project: Project, id: string): Project {
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== id),
    clips: project.clips.filter((c) => c.trackId !== id),
  };
}

export function updateTrack(project: Project, id: string, patch: Partial<Omit<Track, "id">>): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function addClip(project: Project, clip: Clip): Project {
  return { ...project, clips: [...project.clips, clip] };
}

export function deleteClip(project: Project, id: string): Project {
  return { ...project, clips: project.clips.filter((c) => c.id !== id) };
}

export function moveClip(project: Project, id: string, start: number, trackId?: string): Project {
  return mapClip(project, id, (c) => ({ ...c, start: Math.max(0, start), trackId: trackId ?? c.trackId }));
}

/** Move the clip's left edge to `newStart`, revealing or hiding audio. */
export function trimClipStart(project: Project, id: string, newStart: number): Project {
  return mapClip(project, id, (c) => {
    const end = c.start + c.duration;
    // The edge cannot move before the buffer's first sample or the timeline
    // origin, nor past the clip's end.
    const earliest = Math.max(0, c.start - c.offset);
    const start = Math.min(Math.max(newStart, earliest), end - MIN_CLIP);
    return { ...c, start, offset: c.offset + (start - c.start), duration: end - start };
  });
}

/** Move the clip's right edge to `newEnd`, within the recorded audio. */
export function trimClipEnd(project: Project, id: string, newEnd: number, bufferDuration: number): Project {
  return mapClip(project, id, (c) => {
    const maxDuration = bufferDuration - c.offset;
    return { ...c, duration: Math.min(Math.max(newEnd - c.start, MIN_CLIP), maxDuration) };
  });
}

/** Split a clip at timeline time `at`; the right half gets `newClipId`. */
export function splitClip(project: Project, id: string, at: number, newClipId: string): Project {
  const clip = project.clips.find((c) => c.id === id);
  if (!clip || at <= clip.start + MIN_CLIP || at >= clip.start + clip.duration - MIN_CLIP) return project;
  const left: Clip = { ...clip, duration: at - clip.start };
  const right: Clip = {
    ...clip,
    id: newClipId,
    start: at,
    offset: clip.offset + (at - clip.start),
    duration: clip.start + clip.duration - at,
  };
  const clips = project.clips.flatMap((c) => (c.id === id ? [left, right] : [c]));
  return { ...project, clips };
}

/**
 * Clear [start, end) on a track so a new take replaces what was there:
 * covered clips are removed, overlapping ones trimmed, and a clip spanning the
 * whole range is split (its right part gets `rightId`).
 */
export function carveOut(project: Project, trackId: string, start: number, end: number, rightId: string): Project {
  const clips: Clip[] = [];
  for (const c of project.clips) {
    const cEnd = c.start + c.duration;
    if (c.trackId !== trackId || cEnd <= start || c.start >= end) {
      clips.push(c);
      continue;
    }
    if (c.start < start) clips.push({ ...c, duration: start - c.start });
    if (cEnd > end) clips.push({ ...c, id: c.start < start ? rightId : c.id, start: end, offset: c.offset + (end - c.start), duration: cEnd - end });
  }
  return { ...project, clips: clips.filter((c) => c.duration >= MIN_CLIP) };
}

// Undo history over immutable project states.

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** Consecutive commits with the same key (slider drags, typing) form one step. */
  lastKey?: string;
}

const HISTORY_LIMIT = 100;

export function commit(history: History, next: Project, key?: string): History {
  if (next === history.present) return history;
  if (key && key === history.lastKey) return { ...history, present: next, future: [] };
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [], lastKey: key };
}

export function undo(history: History): History {
  const prev = history.past.at(-1);
  if (!prev) return history;
  return { past: history.past.slice(0, -1), present: prev, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}
