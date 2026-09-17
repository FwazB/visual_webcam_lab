interface TempoSegment {
  at: number;
  beat: number;
  bpm: number;
}

/** Audio-context clock that preserves beat position and delayed note timestamps. */
export class BeatClock {
  private segments: TempoSegment[] = [];

  start(at: number, bpm: number, countInBeats: number): void {
    this.segments = [{ at, bpm, beat: -countInBeats }];
  }

  beatsAt(at: number): number {
    if (!this.segments.length) return 0;
    const segment = this.segments.findLast((s) => s.at <= at) ?? this.segments[0];
    return segment.beat + (at - segment.at) * segment.bpm / 60;
  }

  setTempo(at: number, bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0 || !this.segments.length) return;
    const beat = this.beatsAt(at);
    this.segments = this.segments.filter((s) => s.at < at);
    this.segments.push({ at, beat, bpm });
  }
}
