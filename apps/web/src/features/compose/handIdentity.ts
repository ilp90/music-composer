interface Point {
  x: number;
  y: number;
}

interface Track extends Point {
  id: string;
  lastSeen: number;
}

/**
 * Gives each detected hand an id that is stable across frames, by matching every fingertip to the
 * nearest fingertip of the previous frames. MediaPipe's own "Left"/"Right" handedness label flips
 * when a hand is partly out of frame (e.g. pointing at the bottom of the chart), which would reset
 * the hand's dwell timer; position is far steadier at camera frame rates.
 */
export class HandIdentity {
  private tracks: Track[] = [];
  private nextId = 0;

  /**
   * @param maxJump  farthest (normalized frame units) a fingertip may move between frames and keep its id
   * @param lostAfterMs  how long an unseen hand's id is kept, to bridge detection dropouts
   */
  constructor(
    private readonly maxJump = 0.25,
    private readonly lostAfterMs = 200,
  ) {}

  /** Returns one id per point, in order. */
  assign(points: readonly Point[], now: number): string[] {
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.lostAfterMs);

    // Greedy nearest-pair matching; with at most two hands this is optimal in practice.
    const pairs: Array<{ p: number; t: number; d: number }> = [];
    points.forEach((point, p) =>
      this.tracks.forEach((track, t) => {
        const d = Math.hypot(point.x - track.x, point.y - track.y);
        if (d <= this.maxJump) pairs.push({ p, t, d });
      }),
    );
    pairs.sort((a, b) => a.d - b.d);

    const ids: Array<string | undefined> = new Array(points.length);
    const usedTracks = new Set<number>();
    for (const { p, t } of pairs) {
      if (ids[p] !== undefined || usedTracks.has(t)) continue;
      ids[p] = this.tracks[t]!.id;
      usedTracks.add(t);
    }

    return points.map((point, p) => {
      const id = ids[p] ?? `hand-${this.nextId++}`;
      const track = this.tracks.find((t) => t.id === id);
      if (track) Object.assign(track, point, { lastSeen: now });
      else this.tracks.push({ id, ...point, lastSeen: now });
      return id;
    });
  }
}
