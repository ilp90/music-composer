import { describe, expect, it } from 'vitest';
import { coverCrop, pickMimeType, recordingSize } from './recorder';

describe('pickMimeType', () => {
  it('prefers WebM VP9/Opus', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to MP4 (Safari)', () => {
    expect(pickMimeType((t) => t.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1,mp4a');
  });

  it('returns undefined when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});

describe('recordingSize', () => {
  it('caps the longer side at 1280 and keeps the view aspect', () => {
    expect(recordingSize({ width: 2560, height: 1200 })).toEqual({ width: 1280, height: 600 });
    expect(recordingSize({ width: 800, height: 1600 })).toEqual({ width: 640, height: 1280 });
  });

  it('does not upscale small views, and keeps sizes even', () => {
    expect(recordingSize({ width: 641, height: 359 })).toEqual({ width: 642, height: 360 });
  });
});

describe('coverCrop', () => {
  it('crops the sides of a wide source for a tall target', () => {
    expect(coverCrop({ width: 1280, height: 720 }, { width: 360, height: 720 })).toEqual({
      sx: 460,
      sy: 0,
      sw: 360,
      sh: 720,
    });
  });

  it('crops top and bottom for a wider target', () => {
    expect(coverCrop({ width: 1280, height: 720 }, { width: 1280, height: 400 })).toEqual({
      sx: 0,
      sy: 160,
      sw: 1280,
      sh: 400,
    });
  });
});
