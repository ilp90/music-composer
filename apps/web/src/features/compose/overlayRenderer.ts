import {
  MAJOR_KEYS,
  MINOR_KEYS,
  RING_RADII,
  WEDGE_DEGREES,
  wedgeId,
  type ChartLayout,
  type Ring,
} from './circleOfFifths';

export interface OverlayFrame {
  layout: ChartLayout;
  /** 0–1: how see-through the chart is drawn over the camera. */
  opacity: number;
  /** Wedge ids (`wedgeId`) to highlight. */
  active: ReadonlySet<string>;
  /** Fingertip cursors in view pixels. */
  cursors: ReadonlyArray<{ x: number; y: number }>;
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Canvas angle (0 = 3 o'clock, clockwise) of wedge `index`'s center (0 = 12 o'clock). */
const centerAngle = (index: number) => toRadians(index * WEDGE_DEGREES - 90);

function drawRing(
  ctx: CanvasRenderingContext2D,
  { cx, cy, radius }: ChartLayout,
  ring: Ring,
  active: ReadonlySet<string>,
) {
  const [inner, outer] =
    ring === 'major' ? [RING_RADII.split, 1] : [RING_RADII.hole, RING_RADII.split];
  const keys = ring === 'major' ? MAJOR_KEYS : MINOR_KEYS;
  const half = toRadians(WEDGE_DEGREES / 2);

  keys.forEach((key, index) => {
    const mid = centerAngle(index);
    const isActive = active.has(wedgeId({ ring, index }));
    const hue = index * 30;

    ctx.beginPath();
    ctx.arc(cx, cy, outer * radius, mid - half, mid + half);
    ctx.arc(cx, cy, inner * radius, mid + half, mid - half, true);
    ctx.closePath();
    ctx.fillStyle = isActive
      ? `hsl(${hue} 95% 65%)`
      : `hsl(${hue} 70% ${ring === 'major' ? 45 : 32}%)`;
    ctx.shadowColor = isActive ? `hsl(${hue} 100% 70%)` : 'transparent';
    ctx.shadowBlur = isActive ? radius * 0.12 : 0;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, radius * 0.006);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.55)';
    ctx.stroke();

    const labelRadius = ((inner + outer) / 2) * radius;
    const fontSize = radius * (ring === 'major' ? 0.1 : 0.07) * (key.label.length > 4 ? 0.7 : 1);
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(key.label, cx + labelRadius * Math.cos(mid), cy + labelRadius * Math.sin(mid));
  });
}

/** Draws one frame of the overlay. The canvas is assumed already scaled to CSS pixels. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: OverlayFrame,
) {
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = frame.opacity;
  drawRing(ctx, frame.layout, 'major', frame.active);
  drawRing(ctx, frame.layout, 'minor', frame.active);
  ctx.restore();

  // Cursors stay fully opaque so the user always sees where they are pointing.
  for (const { x, y } of frame.cursors) {
    const r = Math.max(6, frame.layout.radius * 0.035);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(255 255 255 / 0.9)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgb(99 102 241)';
    ctx.stroke();
  }
}
