/** How close to an edge counts as grabbing it. */
export const EDGE_HIT_PX = 6;

/**
 * Below this rendered width a region is move-only.
 *
 * A 1.5s shot on a 90s take is about 12px wide. With a 6px hit zone at each
 * end there would be nothing left to grab, so the whole region moves instead.
 */
export const MIN_RESIZABLE_PX = 24;

export type DragKind = "move" | "resize-start" | "resize-end";

/**
 * A pixel offset within a track, as a fraction of that track's width.
 *
 * Deliberately not "pixels to output ms". A drag is measured in the lane's own
 * pixels; turning those into a time needs a scale, and on the cut lane the
 * scale is a function of the very edit the drag is making — growing a cut
 * shortens the output the lane is drawn against. Reporting a fraction and
 * letting each lane choose the timebase it resolves against keeps that scale
 * out of the shared drag machinery entirely. See `useRegionDrag`.
 */
export function pxToFrac(dx: number, trackWidthPx: number): number {
  if (trackWidthPx <= 0) return 0;
  return dx / trackWidthPx;
}

export function msToPct(tMs: number, outputDurationMs: number): number {
  if (outputDurationMs <= 0) return 0;
  return (tMs / outputDurationMs) * 100;
}

/** `offsetPx` is measured from the region's own left edge. */
export function dragKindAt(offsetPx: number, regionWidthPx: number): DragKind {
  if (regionWidthPx < MIN_RESIZABLE_PX) return "move";
  if (offsetPx < EDGE_HIT_PX) return "resize-start";
  if (offsetPx > regionWidthPx - EDGE_HIT_PX) return "resize-end";
  return "move";
}
