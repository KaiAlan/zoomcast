import type { ZoomConfig, ZoomSegment, ZoomWaypoint } from "../zoom/types";
import type { Project } from "./types";

/**
 * The shortest shot with any hold in it.
 *
 * The camera settles `zoomInOverlapMs` after a segment starts and pulls out
 * over `transitionOutMs`. Below their sum the shot arrives and immediately
 * leaves, which is the flinch `applySegmentGuards` exists to prevent.
 *
 * Derived from the live config, never a constant: a user who lowers
 * `transitionOutMs` has earned a shorter floor.
 */
export function minSegmentMs(cfg: ZoomConfig): number {
  return cfg.zoomInOverlapMs + cfg.transitionOutMs;
}

function replaceSegment(
  p: Project,
  id: string,
  fn: (s: ZoomSegment, neighbours: { prevEnd: number; nextStart: number }) => ZoomSegment,
  durationMs: number,
): Project {
  const ordered = [...p.zoom.segments].sort((a, b) => a.startMs - b.startMs);
  const i = ordered.findIndex((s) => s.id === id);
  if (i === -1) return p;

  const target = ordered[i] as ZoomSegment;
  const neighbours = {
    prevEnd: ordered[i - 1]?.endMs ?? 0,
    nextStart: ordered[i + 1]?.startMs ?? durationMs,
  };

  return {
    ...p,
    zoom: {
      ...p.zoom,
      segments: ordered.map((s) => (s.id === id ? fn(target, neighbours) : s)),
    },
  };
}

/**
 * Slide a whole shot, keeping its length.
 *
 * Clamps against the take and against both neighbours; a segment cannot be
 * dragged past another, because two overlapping segments emit keyframes
 * competing for the same instants and the camera would be told two things at
 * once. See `replanSegments`.
 */
export function moveSegment(
  p: Project,
  id: string,
  deltaMs: number,
  durationMs: number,
): Project {
  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      const length = s.endMs - s.startMs;
      const lo = prevEnd;
      const hi = nextStart - length;
      const startMs = Math.max(lo, Math.min(hi, s.startMs + deltaMs));
      const shift = startMs - s.startMs;

      return {
        ...s,
        startMs,
        endMs: startMs + length,
        waypoints: s.waypoints.map((w) => ({ ...w, tMs: w.tMs + shift })),
        pinned: true,
      };
    },
    durationMs,
  );
}

/**
 * How far a waypoint's `tMs` falls outside `[startMs, endMs]`. Zero when it
 * is already inside.
 */
function distanceOutside(tMs: number, startMs: number, endMs: number): number {
  if (tMs < startMs) return startMs - tMs;
  if (tMs > endMs) return tMs - endMs;
  return 0;
}

/**
 * Drop waypoints a resize has pushed outside the segment's new bounds,
 * rather than clamping them into range.
 *
 * Clamping several waypoints into the same edge collapses them onto one
 * timestamp — two keyframes competing for the same instant, the exact
 * failure the no-overlap invariant exists to prevent, produced from inside a
 * single segment. It also recreates the jump `minWaypointGapMs` was added to
 * stop: waypoints squeezed close together produce a huge camera move in a
 * single frame.
 *
 * A segment with no waypoints has no camera target at all, so if dropping
 * would empty the array, the single waypoint nearest the surviving range is
 * kept instead and clamped into bounds.
 */
function clipWaypoints(
  waypoints: ZoomWaypoint[],
  startMs: number,
  endMs: number,
): ZoomWaypoint[] {
  const inRange = waypoints.filter((w) => w.tMs >= startMs && w.tMs <= endMs);
  if (inRange.length > 0 || waypoints.length === 0) return inRange;

  const nearest = waypoints.reduce((closest, w) =>
    distanceOutside(w.tMs, startMs, endMs) < distanceOutside(closest.tMs, startMs, endMs)
      ? w
      : closest,
  );

  return [{ ...nearest, tMs: Math.max(startMs, Math.min(endMs, nearest.tMs)) }];
}

/**
 * Move one edge. The other stays put; the shot changes length.
 *
 * A waypoint the new bounds leave outside `[startMs, endMs]` is dropped, not
 * clamped — see `clipWaypoints`.
 */
export function resizeSegment(
  p: Project,
  id: string,
  edge: "start" | "end",
  tMs: number,
  durationMs: number,
): Project {
  const min = minSegmentMs(p.zoom.config);

  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      if (edge === "start") {
        const startMs = Math.max(prevEnd, Math.min(s.endMs - min, tMs));
        return {
          ...s,
          startMs,
          waypoints: clipWaypoints(s.waypoints, startMs, s.endMs),
          pinned: true,
        };
      }

      const endMs = Math.min(nextStart, Math.max(s.startMs + min, tMs));
      return {
        ...s,
        endMs,
        waypoints: clipWaypoints(s.waypoints, s.startMs, endMs),
        pinned: true,
      };
    },
    durationMs,
  );
}

/**
 * One depth for the whole shot.
 *
 * A travelling segment holds one depth and pans; varying depth across
 * waypoints is not exposed, so this writes to all of them.
 */
export function setSegmentDepth(p: Project, id: string, depth: number): Project {
  const clamped = Math.max(0, Math.min(1, depth));

  return replaceSegment(
    p,
    id,
    (s) => ({
      ...s,
      waypoints: s.waypoints.map((w) => ({ ...w, depth: clamped })),
      pinned: true,
    }),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Switch one shot's camera.
 *
 * Deliberately does NOT pin. Pinning would keep the whole segment wholesale,
 * so the shot would stop re-planning its times when a pacing dial moves —
 * which is not what "switch this shot to follow" asks for. `replanSegments`
 * carries the choice across by id instead.
 */
export function setSegmentCamera(
  p: Project,
  id: string,
  position: "fixed" | "follow",
): Project {
  return replaceSegment(p, id, (s) => ({ ...s, position }), Number.POSITIVE_INFINITY);
}

export function deleteSegment(p: Project, id: string): Project {
  const segments = p.zoom.segments.filter((s) => s.id !== id);
  if (segments.length === p.zoom.segments.length) return p;
  return { ...p, zoom: { ...p.zoom, segments } };
}

/** Hand the shot back to the planner. The caller must re-plan afterwards. */
export function resetSegment(p: Project, id: string): Project {
  return replaceSegment(
    p,
    id,
    (s) => ({ ...s, pinned: false }),
    Number.POSITIVE_INFINITY,
  );
}
