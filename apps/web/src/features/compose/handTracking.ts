import { HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
// Self-hosted WASM runtime (bundled by Vite from node_modules), so no third-party script origin is needed.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

/** ~7.5 MB model, fetched once and cached by the browser. Override with VITE_HAND_MODEL_URL (e.g. our CDN). */
const HAND_MODEL_URL =
  (import.meta.env.VITE_HAND_MODEL_URL as string | undefined) ??
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** MediaPipe landmark 8 is the tip of the index finger. */
const INDEX_FINGERTIP = 8;

export interface Fingertip {
  /** Normalized 0–1 coordinates in the unmirrored camera frame. */
  x: number;
  y: number;
}

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const create = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        // Defaults are 0.5. Slightly lower keeps hands whose palm is partly out of frame,
        // which happens when pointing at the bottom of the chart.
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      },
    );
  try {
    return await create('GPU');
  } catch {
    // No WebGL2 (some VMs / headless browsers): CPU inference is slower but still real-time.
    return create('CPU');
  }
}

export function fingertipsFrom(result: HandLandmarkerResult): Fingertip[] {
  return result.landmarks.flatMap((hand) => {
    const tip = hand[INDEX_FINGERTIP];
    return tip ? [{ x: tip.x, y: tip.y }] : [];
  });
}
