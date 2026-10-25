export type CameraErrorKind = 'unsupported' | 'denied' | 'not-found' | 'in-use' | 'unknown';

export class CameraError extends Error {
  constructor(readonly kind: CameraErrorKind) {
    super(`Camera unavailable: ${kind}`);
    this.name = 'CameraError';
  }
}

export const CAMERA_ERROR_MESSAGES: Record<CameraErrorKind, string> = {
  unsupported:
    'This browser can’t use the camera here. Use a recent Chrome, Edge, Firefox or Safari over HTTPS.',
  denied:
    'Camera access was blocked. Allow the camera (and microphone) in your browser’s site settings, then try again.',
  'not-found': 'No camera was found. Connect one and try again.',
  'in-use': 'The camera is being used by another app. Close it and try again.',
  unknown: 'The camera couldn’t be started. Please try again.',
};

/** Maps getUserMedia's DOMException names to what we can tell the user. */
export function cameraErrorKind(err: unknown): CameraErrorKind {
  const name = (err as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'unknown';
  }
}

const VIDEO: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
};

/**
 * Camera + microphone (the mic is needed for recording, SPEC §2.3). Without a microphone we
 * still start with video only: playing works, and recording captures the synth alone.
 */
export async function getCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
  try {
    return await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: true });
  } catch (err) {
    if (cameraErrorKind(err) !== 'not-found') throw new CameraError(cameraErrorKind(err));
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
  } catch (err) {
    throw new CameraError(cameraErrorKind(err));
  }
}

export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
