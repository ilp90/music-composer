import { describe, expect, it } from 'vitest';
import type { Wedge } from './circleOfFifths';
import { NoteTrigger } from './noteTrigger';

const C: Wedge = { ring: 'major', index: 0 };
const G: Wedge = { ring: 'major', index: 1 };

describe('NoteTrigger', () => {
  it('fires after the fingertip dwells 80 ms on a wedge', () => {
    const t = new NoteTrigger(80);

    expect(t.update('Right', C, 0)).toBeNull();
    expect(t.update('Right', C, 79)).toBeNull();
    expect(t.update('Right', C, 80)).toEqual(C);
  });

  it('does not re-fire while the fingertip stays on the wedge', () => {
    const t = new NoteTrigger(80);
    t.update('Right', C, 0);
    t.update('Right', C, 100);

    expect(t.update('Right', C, 500)).toBeNull();
    expect(t.update('Right', C, 5000)).toBeNull();
  });

  it('ignores a brief jitter across a border', () => {
    const t = new NoteTrigger(80);
    t.update('Right', C, 0);
    t.update('Right', C, 100); // C sounds

    expect(t.update('Right', G, 110)).toBeNull(); // 30 ms on G: too short
    expect(t.update('Right', C, 140)).toBeNull(); // back on C: still held, no re-fire
    expect(t.update('Right', C, 300)).toBeNull();
  });

  it('fires the next wedge after moving and dwelling there', () => {
    const t = new NoteTrigger(80);
    t.update('Right', C, 0);
    t.update('Right', C, 100);

    t.update('Right', G, 200);
    expect(t.update('Right', G, 280)).toEqual(G);
  });

  it('re-fires the same wedge after leaving the chart and coming back', () => {
    const t = new NoteTrigger(80);
    t.update('Right', C, 0);
    t.update('Right', C, 100);

    t.update('Right', null, 150);
    t.update('Right', C, 200);
    expect(t.update('Right', C, 280)).toEqual(C);
  });

  it('tracks hands independently, so two notes can sound together', () => {
    const t = new NoteTrigger(80);
    t.update('Left', C, 0);
    t.update('Right', G, 0);

    expect(t.update('Left', C, 80)).toEqual(C);
    expect(t.update('Right', G, 80)).toEqual(G);
    expect(t.activeWedges()).toEqual([C, G]);
  });

  it('forgets hands missing for longer than the grace period', () => {
    const t = new NoteTrigger(80, 200);
    t.update('Left', C, 0);
    t.update('Left', C, 100);

    t.retain([], 301);
    expect(t.activeWedges()).toEqual([]);
    t.update('Left', C, 400);
    expect(t.update('Left', C, 480)).toEqual(C);
  });

  it('bridges brief detection dropouts without re-triggering', () => {
    const t = new NoteTrigger(80, 200);
    t.update('Left', C, 0);
    expect(t.update('Left', C, 100)).toEqual(C);

    t.retain([], 150); // hand lost for a few frames
    t.retain([], 250);
    expect(t.update('Left', C, 280)).toBeNull(); // back: still the same held note
  });

  it('keeps dwell progress across a dropout', () => {
    const t = new NoteTrigger(80, 200);
    t.update('Left', G, 0);
    t.retain([], 40); // lost mid-dwell

    expect(t.update('Left', G, 90)).toEqual(G); // 90 ms since it arrived on G
  });

  it('only highlights a wedge while the fingertip is still on it', () => {
    const t = new NoteTrigger(80);
    t.update('Right', C, 0);
    t.update('Right', C, 100);
    t.update('Right', G, 120);

    expect(t.activeWedges()).toEqual([]);
  });
});
