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
    const waypoints = openAtRest(s, cfg);
    if (waypoints.length === 0) continue;

    for (const w of waypoints) {
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

    const last = waypoints[waypoints.length - 1];
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
 * Move any waypoint whose transition would start before zero.
 *
 * A keyframe at t = 0 cannot be eased into — its transition would have to
 * start at -transitionMs — so `zoomAt` returns the keyframe's own value from
 * the first frame and the take opens as a hard cut on frame one. The fix is to
 * move the keyframe to `transitionMs`, NOT to shorten the transition: a
 * shortened one would make the opening move faster than every other move in
 * the take, which is the opposite of the intent.
 *
 * Two consequences of moving rather than shortening:
 *
 *   - A waypoint pushed to or past the segment's own end has no room to
 *     arrive, so the segment is dropped — the same pathology `segments.ts`
 *     guards against when a zoom is held for less than its own transitions.
 *   - Two waypoints that both land on `transitionMs` collide, and the camera
 *     can only arrive at one. The later one wins: it is where attention was
 *     when the camera actually gets there.
 */
function openAtRest(s: ZoomSegment, cfg: ZoomConfig): ZoomSegment["waypoints"] {
  const moved = s.waypoints.map((w) => ({ ...w, tMs: Math.max(w.tMs, cfg.transitionMs) }));

  return moved.filter((w, i) => {
    const next = moved[i + 1];
    if (next !== undefined && next.tMs <= w.tMs) return false;
    return w.tMs < s.endMs;
  });
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
