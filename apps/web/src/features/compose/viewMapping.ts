export interface Size {
  width: number;
  height: number;
}

/**
 * Maps a normalized point in the camera frame (MediaPipe landmarks: 0–1, origin top-left of the
 * *unmirrored* frame) to view pixels, matching a `<video>` shown with `object-fit: cover` and
 * mirrored horizontally like a selfie.
 */
export function videoToView(
  nx: number,
  ny: number,
  video: Size,
  view: Size,
  mirrored = true,
): { x: number; y: number } {
  const scale = Math.max(view.width / video.width, view.height / video.height);
  const shownWidth = video.width * scale;
  const shownHeight = video.height * scale;
  const x = (mirrored ? 1 - nx : nx) * shownWidth + (view.width - shownWidth) / 2;
  const y = ny * shownHeight + (view.height - shownHeight) / 2;
  return { x, y };
}
