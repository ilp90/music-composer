import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import type { AudioEngine } from './audioEngine';
import {
  chartLayout,
  hitTest,
  wedgeId,
  wedgeNotes,
  type PlayMode,
  type Wedge,
} from './circleOfFifths';
import type { Fingertip } from './handTracking';
import { HandIdentity } from './handIdentity';
import { NoteTrigger } from './noteTrigger';
import type { SessionRecorder } from './recorder';
import { drawOverlay } from './overlayRenderer';
import { useHandTracking, type HandTrackingStatus } from './useHandTracking';
import { videoToView } from './viewMapping';

const TAP_FLASH_MS = 300;

interface ComposeStageProps {
  /** Null when playing without a camera: tap/click only. */
  stream: MediaStream | null;
  engine: AudioEngine;
  mode: PlayMode;
  opacity: number;
  onPlayed(wedge: Wedge): void;
  onTrackingStatus(status: HandTrackingStatus): void;
  /** While recording, each drawn frame is also composited into the recording. */
  recorder: SessionRecorder | null;
}

/**
 * Camera feed (mirrored) with the circle-of-fifths overlay. Per-frame state lives in refs and is
 * drawn by one requestAnimationFrame loop, so React doesn't re-render at video frame rate.
 */
export function ComposeStage({
  stream,
  engine,
  mode,
  opacity,
  onPlayed,
  onTrackingStatus,
  recorder,
}: ComposeStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [trigger] = useState(() => new NoteTrigger(80, 200));
  const [handIds] = useState(() => new HandIdentity());
  const cursorsRef = useRef<Array<{ x: number; y: number }>>([]);
  const flashesRef = useRef(new Map<string, number>());

  const viewSize = () => ({
    width: containerRef.current?.clientWidth ?? 0,
    height: containerRef.current?.clientHeight ?? 0,
  });

  const play = (wedge: Wedge) => {
    engine.play(wedgeNotes(wedge, mode));
    onPlayed(wedge);
  };

  useEffect(() => {
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      // Autoplay is allowed after the Start click; a failure here only means a paused preview.
    });
  }, [video, stream]);

  const onFingertips = (tips: Fingertip[], now: number) => {
    if (!video?.videoWidth) return;
    const view = viewSize();
    const layout = chartLayout(view.width, view.height);
    const frame = { width: video.videoWidth, height: video.videoHeight };
    const ids = handIds.assign(tips, now);
    const cursors = tips.map((tip, i) => {
      const point = videoToView(tip.x, tip.y, frame, view);
      const fired = trigger.update(ids[i]!, hitTest(point.x, point.y, layout), now);
      if (fired) play(fired);
      return point;
    });
    trigger.retain(ids, now);
    cursorsRef.current = cursors;
  };
  const trackingStatus = useHandTracking(stream ? video : null, onFingertips);

  const reportStatus = useEffectEvent(onTrackingStatus);
  useEffect(() => reportStatus(trackingStatus), [trackingStatus]);

  const draw = useEffectEvent(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = viewSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const now = performance.now();
    const active = new Set(trigger.activeWedges().map(wedgeId));
    for (const [id, until] of flashesRef.current) {
      if (until > now) active.add(id);
      else flashesRef.current.delete(id);
    }
    const layout = chartLayout(width, height);
    // Published for e2e tests, which tap keys by geometry. Only written when it changes.
    const geometry = `${layout.cx},${layout.cy},${layout.radius}`;
    if (containerRef.current && containerRef.current.dataset.chart !== geometry) {
      containerRef.current.dataset.chart = geometry;
    }
    const frame = {
      layout,
      opacity,
      active,
      cursors: trackingStatus === 'ready' ? cursorsRef.current : [],
    };
    drawOverlay(ctx, width, height, frame);
    recorder?.drawFrame(stream ? video : null, frame, { width, height });
  });

  useEffect(() => {
    let handle = requestAnimationFrame(function loop() {
      draw();
      handle = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(handle);
  }, []);

  /** Tap/click fallback: works with or without hand tracking. */
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const { width, height } = viewSize();
    const wedge = hitTest(
      event.clientX - rect.left,
      event.clientY - rect.top,
      chartLayout(width, height),
    );
    if (!wedge) return;
    flashesRef.current.set(wedgeId(wedge), performance.now() + TAP_FLASH_MS);
    play(wedge);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      className="absolute inset-0 touch-none select-none overflow-hidden bg-slate-950"
      data-testid="compose-stage"
    >
      {stream && (
        <video
          ref={setVideo}
          muted
          playsInline
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
          data-testid="camera-preview"
        />
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Circle of fifths. Point at a key with your index finger, or tap it, to play it."
        className="absolute inset-0 h-full w-full"
      />
    </div>
  );
}
