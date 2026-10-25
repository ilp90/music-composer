import { describe, expect, it } from 'vitest';
import { HandIdentity } from './handIdentity';

describe('HandIdentity', () => {
  it('keeps the same id for a hand that moves between frames', () => {
    const ids = new HandIdentity();
    const [first] = ids.assign([{ x: 0.5, y: 0.5 }], 0);

    expect(ids.assign([{ x: 0.55, y: 0.6 }], 33)).toEqual([first]);
    expect(ids.assign([{ x: 0.6, y: 0.7 }], 66)).toEqual([first]);
  });

  it('tells two hands apart by position, regardless of detection order', () => {
    const ids = new HandIdentity();
    const [left, right] = ids.assign(
      [
        { x: 0.2, y: 0.5 },
        { x: 0.8, y: 0.5 },
      ],
      0,
    );

    expect(left).not.toBe(right);
    expect(
      ids.assign(
        [
          { x: 0.78, y: 0.52 },
          { x: 0.22, y: 0.48 },
        ],
        33,
      ),
    ).toEqual([right, left]);
  });

  it('keeps the id through a short dropout', () => {
    const ids = new HandIdentity(0.25, 200);
    const [first] = ids.assign([{ x: 0.5, y: 0.8 }], 0);

    ids.assign([], 33);
    ids.assign([], 100);
    expect(ids.assign([{ x: 0.52, y: 0.82 }], 150)).toEqual([first]);
  });

  it('gives a new id after a long absence or a big jump', () => {
    const ids = new HandIdentity(0.25, 200);
    const [first] = ids.assign([{ x: 0.5, y: 0.5 }], 0);

    expect(ids.assign([{ x: 0.5, y: 0.5 }], 500)).not.toEqual([first]);
    const [second] = ids.assign([{ x: 0.1, y: 0.1 }], 533);
    expect(ids.assign([{ x: 0.9, y: 0.9 }], 566)).not.toEqual([second]);
  });
});
