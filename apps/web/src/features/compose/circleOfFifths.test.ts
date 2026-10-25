import { describe, expect, it } from 'vitest';
import {
  chartLayout,
  hitTest,
  MAJOR_KEYS,
  MINOR_KEYS,
  RING_RADII,
  wedgeName,
  wedgeNotes,
  type Wedge,
} from './circleOfFifths';

const layout = chartLayout(1000, 800); // radius = 800 * 0.7 / 2 = 280, center (500, 360)

/** Point at `fraction` of the radius, `degrees` clockwise from 12 o'clock. */
function pointAt(degrees: number, fraction: number) {
  const rad = (degrees * Math.PI) / 180;
  const r = fraction * layout.radius;
  return { x: layout.cx + r * Math.sin(rad), y: layout.cy - r * Math.cos(rad) };
}

const MAJOR_MID = (RING_RADII.split + 1) / 2;
const MINOR_MID = (RING_RADII.hole + RING_RADII.split) / 2;

describe('chartLayout', () => {
  it('places a chart 70% of the shorter side wide, centered horizontally and slightly high', () => {
    expect(layout).toEqual({ cx: 500, cy: 360, radius: 280 });
    expect(chartLayout(400, 900).radius).toBe(140);
  });
});

describe('hitTest', () => {
  it.each(MAJOR_KEYS.map((key, index) => [key.label, index] as const))(
    'outer ring wedge %s (index %i) at its center angle',
    (_label, index) => {
      const { x, y } = pointAt(index * 30, MAJOR_MID);
      expect(hitTest(x, y, layout)).toEqual({ ring: 'major', index });
    },
  );

  it.each(MINOR_KEYS.map((key, index) => [key.label, index] as const))(
    'inner ring wedge %s (index %i) at its center angle',
    (_label, index) => {
      const { x, y } = pointAt(index * 30, MINOR_MID);
      expect(hitTest(x, y, layout)).toEqual({ ring: 'minor', index });
    },
  );

  it('puts C at 12 o’clock, G at 1 o’clock and F at 11 o’clock', () => {
    const at = (deg: number) => {
      const p = pointAt(deg, MAJOR_MID);
      return MAJOR_KEYS[hitTest(p.x, p.y, layout)!.index]!.label;
    };
    expect(at(0)).toBe('C');
    expect(at(30)).toBe('G');
    expect(at(330)).toBe('F');
  });

  it('splits wedges at ±15° from their centers', () => {
    const just = (deg: number) => {
      const p = pointAt(deg, MAJOR_MID);
      return hitTest(p.x, p.y, layout)!.index;
    };
    expect(just(14.9)).toBe(0);
    expect(just(15.1)).toBe(1);
    expect(just(345.1)).toBe(0);
    expect(just(344.9)).toBe(11);
  });

  it('returns null outside the chart and in the center hole', () => {
    const outside = pointAt(45, 1.01);
    const hole = pointAt(45, RING_RADII.hole - 0.01);
    expect(hitTest(outside.x, outside.y, layout)).toBeNull();
    expect(hitTest(hole.x, hole.y, layout)).toBeNull();
    expect(hitTest(layout.cx, layout.cy, layout)).toBeNull();
    expect(hitTest(0, 0, layout)).toBeNull();
  });

  it('splits the rings at the configured radius', () => {
    const outer = pointAt(0, RING_RADII.split + 0.001);
    const inner = pointAt(0, RING_RADII.split - 0.001);
    expect(hitTest(outer.x, outer.y, layout)?.ring).toBe('major');
    expect(hitTest(inner.x, inner.y, layout)?.ring).toBe('minor');
  });
});

describe('relative minors', () => {
  it('sit a minor third below their major', () => {
    MAJOR_KEYS.forEach((major, i) => {
      expect((major.pitchClass - MINOR_KEYS[i]!.pitchClass + 12) % 12).toBe(3);
    });
  });

  it('cover all 12 pitch classes once per ring', () => {
    expect(new Set(MAJOR_KEYS.map((k) => k.pitchClass)).size).toBe(12);
    expect(new Set(MINOR_KEYS.map((k) => k.pitchClass)).size).toBe(12);
  });
});

describe('wedgeNotes', () => {
  const C: Wedge = { ring: 'major', index: 0 };
  const Am: Wedge = { ring: 'minor', index: 0 };
  const Fsharp: Wedge = { ring: 'major', index: 6 };

  it('plays major roots in octave 4 and minor roots in octave 3', () => {
    expect(wedgeNotes(C, 'note')).toEqual([60]); // C4
    expect(wedgeNotes(Fsharp, 'note')).toEqual([66]); // F#4
    expect(wedgeNotes(Am, 'note')).toEqual([57]); // A3
  });

  it('plays major and minor triads in chord mode', () => {
    expect(wedgeNotes(C, 'chord')).toEqual([60, 64, 67]); // C E G
    expect(wedgeNotes(Am, 'chord')).toEqual([57, 60, 64]); // A C E
  });
});

describe('wedgeName', () => {
  it('names keys for screen readers', () => {
    expect(wedgeName({ ring: 'major', index: 0 })).toBe('C major');
    expect(wedgeName({ ring: 'minor', index: 0 })).toBe('A minor');
    expect(wedgeName({ ring: 'minor', index: 3 })).toBe('F♯ minor');
    expect(wedgeName({ ring: 'minor', index: 6 })).toBe('D♯/E♭ minor');
  });
});
