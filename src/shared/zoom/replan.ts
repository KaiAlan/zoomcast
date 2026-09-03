import type { ZoomKeyframe } from "./types";

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
