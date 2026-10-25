/**
 * Circle of fifths: data, geometry and hit testing. Pure (no DOM, no audio) so it is unit-tested directly.
 * Wedge index 0 is at 12 o'clock and indices increase clockwise; each wedge spans 30°.
 */

export type Ring = 'major' | 'minor';
export type PlayMode = 'note' | 'chord';

export interface Wedge {
  ring: Ring;
  /** 0–11, clockwise from 12 o'clock. */
  index: number;
}

interface KeyInfo {
  label: string;
  /** Pitch class of the key's root: C = 0 … B = 11. */
  pitchClass: number;
}

export const MAJOR_KEYS: readonly KeyInfo[] = [
  { label: 'C', pitchClass: 0 },
  { label: 'G', pitchClass: 7 },
  { label: 'D', pitchClass: 2 },
  { label: 'A', pitchClass: 9 },
  { label: 'E', pitchClass: 4 },
  { label: 'B', pitchClass: 11 },
  { label: 'F♯/G♭', pitchClass: 6 },
  { label: 'D♭', pitchClass: 1 },
  { label: 'A♭', pitchClass: 8 },
  { label: 'E♭', pitchClass: 3 },
  { label: 'B♭', pitchClass: 10 },
  { label: 'F', pitchClass: 5 },
];

/** Relative minors, aligned with MAJOR_KEYS by index. */
export const MINOR_KEYS: readonly KeyInfo[] = [
  { label: 'Am', pitchClass: 9 },
  { label: 'Em', pitchClass: 4 },
  { label: 'Bm', pitchClass: 11 },
  { label: 'F♯m', pitchClass: 6 },
  { label: 'C♯m', pitchClass: 1 },
  { label: 'G♯m', pitchClass: 8 },
  { label: 'D♯m/E♭m', pitchClass: 3 },
  { label: 'B♭m', pitchClass: 10 },
  { label: 'Fm', pitchClass: 5 },
  { label: 'Cm', pitchClass: 0 },
  { label: 'Gm', pitchClass: 7 },
  { label: 'Dm', pitchClass: 2 },
];

export const WEDGE_DEGREES = 30;

/** Ring boundaries as fractions of the chart radius: [hole, minor ring) and [minor/major split, 1]. */
export const RING_RADII = { hole: 0.3, split: 0.62 } as const;

/** Chart diameter as a fraction of the shorter side of the view. */
export const CHART_SIZE = 0.7;

/**
 * Chart center height as a fraction of the view. Slightly above the middle: to point at the bottom
 * keys the hand moves down, and its palm (which MediaPipe needs to see) must stay inside the frame.
 */
export const CHART_CENTER_Y = 0.45;

export interface ChartLayout {
  cx: number;
  cy: number;
  radius: number;
}

export function chartLayout(width: number, height: number): ChartLayout {
  return {
    cx: width / 2,
    cy: height * CHART_CENTER_Y,
    radius: (Math.min(width, height) * CHART_SIZE) / 2,
  };
}

/** The wedge under a point in view coordinates, or null outside the chart or in its center hole. */
export function hitTest(x: number, y: number, layout: ChartLayout): Wedge | null {
  const dx = x - layout.cx;
  const dy = y - layout.cy;
  const r = Math.hypot(dx, dy) / layout.radius;
  if (r > 1 || r < RING_RADII.hole) return null;

  // Angle from 12 o'clock, clockwise (screen y grows downward).
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const index = Math.floor(((degrees + WEDGE_DEGREES / 2) % 360) / WEDGE_DEGREES);
  return { ring: r >= RING_RADII.split ? 'major' : 'minor', index };
}

export function sameWedge(a: Wedge | null, b: Wedge | null): boolean {
  return a === b || (a !== null && b !== null && a.ring === b.ring && a.index === b.index);
}

export function wedgeId(wedge: Wedge): string {
  return `${wedge.ring}:${wedge.index}`;
}

export function keyOf(wedge: Wedge): KeyInfo {
  return (wedge.ring === 'major' ? MAJOR_KEYS : MINOR_KEYS)[wedge.index]!;
}

/** "C major", "F♯m" → "F♯ minor". */
export function wedgeName(wedge: Wedge): string {
  const { label } = keyOf(wedge);
  return wedge.ring === 'major'
    ? `${label} major`
    : `${label.replace(/m$/, '').replace(/m\//, '/')} minor`;
}

/**
 * MIDI notes to play. Majors sound in octave 4, minors in octave 3 (SPEC §2.2);
 * chord mode plays the major (0-4-7) or minor (0-3-7) triad on that root.
 */
export function wedgeNotes(wedge: Wedge, mode: PlayMode): number[] {
  const octave = wedge.ring === 'major' ? 4 : 3;
  const root = 12 * (octave + 1) + keyOf(wedge).pitchClass; // MIDI: C4 = 60
  if (mode === 'note') return [root];
  return wedge.ring === 'major' ? [root, root + 4, root + 7] : [root, root + 3, root + 7];
}
