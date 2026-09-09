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

export function pxToMs(dx: number, trackWidthPx: number, outputDurationMs: number): number {
  if (trackWidthPx <= 0) return 0;
  return (dx / trackWidthPx) * outputDurationMs;
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
