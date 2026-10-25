import { sameWedge, type Wedge } from './circleOfFifths';

interface HandState {
  /** Wedge the fingertip is currently over, and since when (for the dwell). */
  candidate: Wedge | null;
  since: number;
  /** Wedge that last sounded for this hand; it won't sound again until the fingertip leaves it. */
  active: Wedge | null;
  lastSeen: number;
}

/**
 * Turns per-frame fingertip positions into note triggers, per hand:
 * a wedge sounds once the fingertip has stayed on it for `dwellMs` (filters landmark jitter at
 * wedge borders), and doesn't re-sound until the fingertip moves to another wedge or off the chart.
 */
export class NoteTrigger {
  private readonly hands = new Map<string, HandState>();

  /**
   * @param dwellMs  how long a fingertip must stay on a wedge before it sounds
   * @param lostAfterMs  how long an undetected hand keeps its state, so a few dropped frames
   *   (common when the palm is near the frame edge) don't restart the dwell or re-trigger the note
   */
  constructor(
    private readonly dwellMs = 80,
    private readonly lostAfterMs = 200,
  ) {}

  /** Feed one observation; returns the wedge to play now, if any. */
  update(handId: string, wedge: Wedge | null, now: number): Wedge | null {
    let state = this.hands.get(handId);
    if (!state) {
      state = { candidate: null, since: now, active: null, lastSeen: now };
      this.hands.set(handId, state);
    }
    state.lastSeen = now;

    if (!sameWedge(wedge, state.candidate)) {
      state.candidate = wedge;
      state.since = now;
    }
    if (wedge === null) {
      state.active = null;
      return null;
    }
    if (sameWedge(wedge, state.active) || now - state.since < this.dwellMs) return null;

    state.active = wedge;
    return wedge;
  }

  /** Drop hands not detected for longer than `lostAfterMs`, so they re-trigger when they come back. */
  retain(handIds: Iterable<string>, now: number): void {
    const seen = new Set(handIds);
    for (const [id, state] of this.hands) {
      if (!seen.has(id) && now - state.lastSeen > this.lostAfterMs) this.hands.delete(id);
    }
  }

  /** Wedges currently held by a hand (for highlighting). */
  activeWedges(): Wedge[] {
    return [...this.hands.values()].flatMap((s) =>
      s.active && sameWedge(s.active, s.candidate) ? [s.active] : [],
    );
  }
}
