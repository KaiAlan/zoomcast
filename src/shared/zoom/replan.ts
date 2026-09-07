import type { ZoomKeyframe, ZoomSegment } from "./types";

/**
 * Merge a fresh plan into an existing one, preserving user intent.
 *
 * A keyframe survives re-planning if the user pinned it or authored it.
 * Everything else is regenerated. This is what lets you keep tuning the global
 * curve feel forever without losing per-clip fixes — the planner is allowed to
 * be wrong, as long as its mistakes are correctable and its corrections stick.
 */
export function replan(
  existing: ZoomKeyframe[],
  generated: ZoomKeyframe[],
): ZoomKeyframe[] {
  const keep = existing.filter((k) => k.pinned || k.origin === "manual");
  const keptIds = new Set(keep.map((k) => k.id));
  const fresh = generated.filter((k) => !keptIds.has(k.id));

  return [...keep, ...fresh].sort((a, b) => a.tSourceMs - b.tSourceMs);
}

/**
 * The same contract, one level up: a segment survives re-planning if the user
 * pinned it or authored it.
 *
 * Matching is by overlap rather than by id, because a kept segment owns that
 * stretch of the timeline — a generated segment crossing it would emit
 * keyframes competing with the kept one's for the same instants, and the
 * camera would be told two things at once. Segments are the persisted unit, so
 * this is what makes "switch this shot to follow" stick across the re-plan
 * every load performs.
 */
export function replanSegments(
  existing: ZoomSegment[],
  generated: ZoomSegment[],
): ZoomSegment[] {
  const keep = existing.filter((s) => s.pinned || s.origin === "manual");
  const clashes = (s: ZoomSegment): boolean =>
    keep.some((k) => s.startMs < k.endMs && k.startMs < s.endMs);

  return [...keep, ...generated.filter((s) => !clashes(s))].sort(
    (a, b) => a.startMs - b.startMs,
  );
}
