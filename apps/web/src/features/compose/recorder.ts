import { MAX_RECORDING_MS } from '@mc/shared';
import { chartLayout } from './circleOfFifths';
import { drawOverlay, type OverlayFrame } from './overlayRenderer';
import type { Size } from './viewMapping';

/** Preferred containers/codecs, best first: WebM (Chrome, Firefox, Edge), then MP4 (Safari). */
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
];

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((type) => isSupported(type));
}

export function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMimeType((t) => MediaRecorder.isTypeSupported(t)) !== undefined
  );
}

/** Recording resolution: the view's aspect ratio with its longer side at most `maxSide` (720p-class). */
export function recordingSize(view: Size, maxSide = 1280): Size {
  const scale = Math.min(1, maxSide / Math.max(view.width, view.height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2); // encoders want even sizes
  return { width: even(view.width), height: even(view.height) };
}

/** Source rectangle that makes `source` cover `target` (CSS object-fit: cover), centered. */
export function coverCrop(source: Size, target: Size) {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const sw = target.width / scale;
  const sh = target.height / scale;
  return { sx: (source.width - sw) / 2, sy: (source.height - sh) / 2, sw, sh };
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/**
 * Records exactly what the user sees: each frame, the mirrored camera (cropped like the on-screen
 * view) and the overlay are drawn into a canvas; its video track plus the mixed audio go into a
 * MediaRecorder. Stops itself after MAX_RECORDING_MS.
 */
export class SessionRecorder {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly startedAt = performance.now();
  private readonly autoStop: ReturnType<typeof setTimeout>;
  private stopped: Promise<RecordingResult> | null = null;

  constructor(view: Size, audio: MediaStream, onAutoStop: () => void) {
    Object.assign(this.canvas, recordingSize(view));
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#020617';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    const stream = new MediaStream([
      ...this.canvas.captureStream(30).getVideoTracks(),
      ...audio.getAudioTracks(),
    ]);
    this.recorder = new MediaRecorder(stream, {
      ...(mimeType && { mimeType }),
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // 1 s chunks: a crash loses at most a second
    this.autoStop = setTimeout(onAutoStop, MAX_RECORDING_MS);
  }

  elapsedMs(): number {
    return performance.now() - this.startedAt;
  }

  /** Draws one frame. `frame` is in view pixels; it's scaled to the recording size. */
  drawFrame(video: HTMLVideoElement | null, frame: OverlayFrame, view: Size): void {
    if (this.stopped) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    if (video && video.videoWidth > 0) {
      const crop = coverCrop(
        { width: video.videoWidth, height: video.videoHeight },
        { width, height },
      );
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1); // mirrored, like the preview
      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
      ctx.restore();
    }

    const scale = width / view.width;
    drawOverlay(ctx, width, height, {
      ...frame,
      layout: chartLayout(width, height),
      cursors: frame.cursors.map((c) => ({ x: c.x * scale, y: c.y * scale })),
    });
  }

  /** Stops and resolves with the finished video. Safe to call more than once. */
  stop(): Promise<RecordingResult> {
    this.stopped ??= new Promise((resolve) => {
      clearTimeout(this.autoStop);
      const durationMs = Math.round(this.elapsedMs());
      this.recorder.onstop = () => {
        const mimeType = this.recorder.mimeType || this.chunks[0]?.type || 'video/webm';
        resolve({ blob: new Blob(this.chunks, { type: mimeType }), mimeType, durationMs });
      };
      if (this.recorder.state === 'inactive') this.recorder.onstop(new Event('stop'));
      else this.recorder.stop();
      this.recorder.stream.getVideoTracks().forEach((t) => t.stop());
    });
    return this.stopped;
  }
}
