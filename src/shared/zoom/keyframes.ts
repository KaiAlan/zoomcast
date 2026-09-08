import { cursorAt, type CursorPath } from "../cursor/path";
import { clampToSource } from "./camera";
import type { PlanContext, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

/**
 * How often a follow segment emits a keyframe.
 *
 * The path it samples is already damped at a several-hundred-millisecond
 * half-life, so 100ms with a linear ramp between samples reproduces it to well
 * under a pixel; the alternative — one keyframe per frame — would put the
 * output frame rate into the keyframe list, which is exactly what precomputing
 * the path exists to avoid.
 */
export const FOLLOW_SAMPLE_MS = 100;

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
  /**
   * The precomputed camera path, in source pixels. Only `position: "follow"`
   * segments read it; without one they fall back to their waypoints, so the
   * planner, the tune tool and the tests need not build a path at all.
   */
  follow: CursorPath | null = null,
): ZoomKeyframe[] {
  // The configured cap, not the pixel-parity point. Before 2026-09-07 these
  // were the same number, and that is exactly what capped every zoom at
  // full-bleed with nowhere for the camera to go.
  const ceiling = cfg.maxZoom;
  const kfs: ZoomKeyframe[] = [];

  for (const s of segments) {
    const waypoints = openAtRest(s, cfg);
    if (waypoints.length === 0) continue;

    for (const [i, w] of waypoints.entries()) {
      const centre =
        s.position === "follow" && follow !== null
          ? followCentre(follow, w.tMs, depthToScale(w.depth, ceiling), ctx, w)
          : { cx: w.cx, cy: w.cy };

      // The zoom-in settles `zoomInOverlapMs` into its own region, so the
      // camera is still arriving as activity begins.
      //
      // A FLOOR, not an increment. openAtRest already delays a segment that
      // starts too early to transition from rest into, and that camera is
      // arriving late for a physical reason -- pushing it later again would
      // double-delay it for no gain. Only the first waypoint is the zoom-in;
      // the rest are travel inside a shot already arrived in.
      //
      // Clamped against the next waypoint and the segment end: a short region
      // with a long overlap must not settle after it is over, and must never
      // reorder the waypoints.
      //
      // The overlap may never eat the hold. planZoom guarantees every shot
      // keeps minDwellMs, and enough room to run its own exit; taking 500ms
      // off the front of that left 950ms against a required 1450ms. When the
      // segment is too short to give the overlap away, it simply does not
      // apply -- the guarantee outranks the flourish.
      const latestSettleMs = Math.min(
        waypoints[i + 1]?.tMs ?? s.endMs,
        s.endMs - Math.max(cfg.minDwellMs, cfg.transitionOutMs),
      );
      const settleMs =
        i === 0
          ? Math.max(w.tMs, Math.min(Math.max(w.tMs, s.startMs + cfg.zoomInOverlapMs), latestSettleMs))
          : w.tMs;

      kfs.push({
        id: `${w.id}i`,
        tSourceMs: settleMs,
        scale: depthToScale(w.depth, ceiling),
        ...centre,
        // The first waypoint is the zoom-in; the rest are the camera
        // travelling inside a shot it has already arrived in, which is a
        // gentler move on its own curve.
        easing: i === 0 ? cfg.easing : "cameraPan",
        transitionMs: i === 0 ? cfg.transitionMs : cfg.panMs,
        origin: s.origin,
        pinned: s.pinned,
      });
    }

    const last = waypoints[waypoints.length - 1];
    if (last === undefined) continue;

    // A follow segment tracks between its waypoints too: sample the path on a
    // fixed cadence and let zoomAt ramp linearly between the samples. The
    // samples come from one precomputed array, so preview and export see the
    // same camera.
    const tail =
      s.position === "follow" && follow !== null
        ? sampleFollow(follow, last, s, cfg, ctx, ceiling)
        : [];
    kfs.push(...tail);

    const end = tail[tail.length - 1] ?? { cx: last.cx, cy: last.cy };

    kfs.push({
      id: `${last.id}o`,
      tSourceMs: s.endMs,
      scale: 1,
      cx: end.cx,
      cy: end.cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionOutMs,
      origin: s.origin,
      pinned: s.pinned,
    });
  }

  return kfs.sort((a, b) => a.tSourceMs - b.tSourceMs);
}

/** The camera path at one instant, normalised and clamped, in 0..1 of source. */
function followCentre(
  path: CursorPath,
  tMs: number,
  scale: number,
  ctx: PlanContext,
  fallback: { cx: number; cy: number },
): { cx: number; cy: number } {
  const at = cursorAt(path, tMs);
  if (at === null) return fallback;

  return clampToSource(
    { cx: at.x / ctx.source.w, cy: at.y / ctx.source.h },
    scale,
    ctx,
  );
}

/** The follow samples between a segment's last waypoint and its end. */
function sampleFollow(
  path: CursorPath,
  last: ZoomSegment["waypoints"][number],
  s: ZoomSegment,
  cfg: ZoomConfig,
  ctx: PlanContext,
  ceiling: number,
): ZoomKeyframe[] {
  const scale = depthToScale(last.depth, ceiling);
  const out: ZoomKeyframe[] = [];

  // Stop short of the end: the pull-out transition starts at
  // endMs - transitionMs, and a follow sample inside it would fight it.
  const until = s.endMs - cfg.transitionOutMs;

  for (let t = last.tMs + FOLLOW_SAMPLE_MS, n = 0; t < until; t += FOLLOW_SAMPLE_MS, n++) {
    out.push({
      id: `${last.id}f${n}`,
      tSourceMs: t,
      scale,
      ...followCentre(path, t, scale, ctx, last),
      easing: "linear",
      transitionMs: FOLLOW_SAMPLE_MS,
      origin: s.origin,
      pinned: s.pinned,
    });
  }

  return out;
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
