import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useEffectEvent, useState } from 'react';
import { createHandLandmarker, fingertipsFrom, type Fingertip } from './handTracking';

export type HandTrackingStatus = 'off' | 'loading' | 'ready' | 'unavailable';

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Runs MediaPipe hand detection on every new camera frame (requestVideoFrameCallback, so we never
 * process the same frame twice) and reports index fingertips. If the model can't load, reports
 * 'unavailable' and the page keeps working with tap/click.
 */
export function useHandTracking(
  video: HTMLVideoElement | null,
  onFingertips: (tips: Fingertip[], now: number) => void,
): HandTrackingStatus {
  // Outcome of loading the model for a given <video>; anything else for the current video is 'loading'.
  const [outcome, setOutcome] = useState<{
    video: HTMLVideoElement;
    status: 'ready' | 'unavailable';
  } | null>(null);
  const report = useEffectEvent(onFingertips);

  useEffect(() => {
    if (!video) return;
    const v = video as VideoWithFrameCallback;
    let landmarker: HandLandmarker | null = null;
    let cancelled = false;
    let handle = 0;

    const schedule = () => {
      handle = v.requestVideoFrameCallback
        ? v.requestVideoFrameCallback(onFrame)
        : requestAnimationFrame(onFrame);
    };
    const onFrame = () => {
      if (cancelled || !landmarker) return;
      if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth > 0) {
        const now = performance.now();
        try {
          report(fingertipsFrom(landmarker.detectForVideo(v, now)), now);
        } catch {
          // A single bad frame (e.g. during a resolution change) shouldn't stop tracking.
        }
      }
      schedule();
    };

    createHandLandmarker()
      .then((created) => {
        if (cancelled) {
          created.close();
          return;
        }
        landmarker = created;
        setOutcome({ video, status: 'ready' });
        schedule();
      })
      .catch(() => {
        if (!cancelled) setOutcome({ video, status: 'unavailable' });
      });

    return () => {
      cancelled = true;
      if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      landmarker?.close();
    };
  }, [video]);

  if (!video) return 'off';
  return outcome?.video === video ? outcome.status : 'loading';
}
