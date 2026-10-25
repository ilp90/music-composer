import { describe, expect, it } from 'vitest';
import { videoToView } from './viewMapping';

const video = { width: 1280, height: 720 };

describe('videoToView', () => {
  it('maps directly when the view has the video aspect ratio', () => {
    const view = { width: 640, height: 360 };

    expect(videoToView(0.25, 0.5, video, view, false)).toEqual({ x: 160, y: 180 });
  });

  it('mirrors horizontally like a selfie view', () => {
    const view = { width: 640, height: 360 };

    expect(videoToView(0.25, 0.5, video, view)).toEqual({ x: 480, y: 180 });
  });

  it('accounts for object-fit: cover cropping the sides of a tall view', () => {
    // 400x720 view: video scaled to 1280x720, 440 px cropped each side.
    const view = { width: 400, height: 720 };

    expect(videoToView(0.5, 0.5, video, view)).toEqual({ x: 200, y: 360 });
    expect(videoToView(0.34375, 0, video, view, false)).toEqual({ x: 0, y: 0 }); // 440/1280
  });

  it('accounts for cropping the top and bottom of a wide view', () => {
    // 1280x400 view: video stays 1280x720, 160 px cropped top and bottom.
    const view = { width: 1280, height: 400 };

    expect(videoToView(0, 160 / 720, video, view, false)).toEqual({ x: 0, y: 0 });
  });
});
