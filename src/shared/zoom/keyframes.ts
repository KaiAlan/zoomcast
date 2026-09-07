import { maxComfortableZoom } from "./geometry";
import type { PlanContext, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

/**
 * Segments to keyframes: the render-time representation, derived.
 *
 * This emission used to live inside `planZoom`, which meant the only way to
 * get keyframes was to re-run the whole planner from telemetry. Segments are
 * now the persisted, editable unit, so deriving has to be a step of its own —
 * an edit to a segment re-derives without re-planning, and re-planning cannot
 * quietly change what an untouched segment renders as.
 *
 * A segment emits one in-keyframe per waypoint and a single scale-1
 * out-keyframe at its end. Several waypoints therefore mean the camera travels
 * between focus points while staying in; that is the shape `applySegmentGuards`
 * produces and it is preserved exactly here.
 */
export function segmentsToKeyframes(
  segments: ZoomSegment[],
  cfg: ZoomConfig,
  ctx: PlanContext,
): ZoomKeyframe[] {
  const ceiling = maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor);
  const kfs: ZoomKeyframe[] = [];

  for (const s of segments) {
    for (const w of s.waypoints) {
      kfs.push({
        id: `${w.id}i`,
        tSourceMs: w.tMs,
        scale: depthToScale(w.depth, ceiling),
        cx: w.cx,
        cy: w.cy,
        easing: cfg.easing,
        transitionMs: cfg.transitionMs,
        origin: s.origin,
        pinned: s.pinned,
      });
    }

    const last = s.waypoints[s.waypoints.length - 1];
    if (last === undefined) continue;

    kfs.push({
      id: `${last.id}o`,
      tSourceMs: s.endMs,
      scale: 1,
      cx: last.cx,
      cy: last.cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: s.origin,
      pinned: s.pinned,
    });
  }

  return kfs.sort((a, b) => a.tSourceMs - b.tSourceMs);
}

/**
 * 0..1 onto the ceiling, and back.
 *
 * Stored depth is relative so a segment survives an aspect change: the ceiling
 * derives from the output size, so an absolute scale planned for 16:9 would be
 * wrong the moment the user picks 1:1.
 */
export function depthToScale(depth: number, ceiling: number): number {
  return 1 + Math.min(1, Math.max(0, depth)) * (ceiling - 1);
}

export function scaleToDepth(scale: number, ceiling: number): number {
  return ceiling <= 1 ? 0 : (scale - 1) / (ceiling - 1);
}
