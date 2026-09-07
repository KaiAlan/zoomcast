import type { ZoomConfig } from "./types";

/**
 * One waypoint the camera visits without pulling back out. The id is the
 * cluster that produced it, so replan() can still match a pinned keyframe.
 */
export type Waypoint = {
  id: string;
  t: number;
  scale: number;
  cx: number;
  cy: number;
};

/**
 * A continuous period at scale > 1. One waypoint is an ordinary zoom; several
 * mean the camera travels between focus points while staying in.
 */
export type Segment = { startT: number; endT: number; waypoints: Waypoint[] };

/**
 * Guards that only make sense once zoom times exist.
 *
 * The cluster guards in guards.ts work on attention, not on camera moves, so
 * they cannot see either pathology real footage produces:
 *
 *   - a zoom held for less time than its own transitions take, so the camera
 *     never arrives and the move reads as a twitch;
 *   - a zoom-out followed 140ms later by a zoom-in somewhere else, which is a
 *     flinch rather than two shots.
 *
 * Both are about the emitted segments, so they are guarded here.
 */
export function applySegmentGuards(segs: Segment[], cfg: ZoomConfig): Segment[] {
  return enforceDwell(mergeForRecovery(segs, cfg), cfg);
}

/**
 * Segments too close to sit apart become one travelling segment.
 *
 * Pulling out and straight back in costs two transitions and reads as a
 * flinch; staying in and moving costs one and reads as a pan.
 */
function mergeForRecovery(segs: Segment[], cfg: ZoomConfig): Segment[] {
  const out: Segment[] = [];

  for (const s of segs) {
    const prev = out[out.length - 1];

    if (prev !== undefined && s.startT - prev.endT < cfg.minRecoveryMs) {
      prev.endT = Math.max(prev.endT, s.endT);
      prev.waypoints = [...prev.waypoints, ...s.waypoints];
      continue;
    }

    out.push({ ...s, waypoints: [...s.waypoints] });
  }

  return out;
}

/**
 * Hold each zoom long enough to be a shot rather than a move, and not so long
 * that the take lives zoomed in.
 *
 * `minDwellMs` is the target and `maxDwellMs` the cap. The floor is
 * `transitionOutMs` alone, not both transitions: a keyframe is the instant the
 * camera ARRIVES, so the zoom-in eases into `startT` from before it and cannot
 * constrain how long the segment lasts. Only the exit is paid from inside.
 * (It read `transitionMs * 2` while the two durations were one number.)
 *
 * A segment that cannot reach the floor without eating the next one's recovery
 * gap has nowhere to exist, and is dropped.
 */
function enforceDwell(segs: Segment[], cfg: ZoomConfig): Segment[] {
  const floor = cfg.transitionOutMs;
  const out: Segment[] = [];

  segs.forEach((s, i) => {
    const next = segs[i + 1];
    const latestEnd =
      next === undefined ? Infinity : next.startT - cfg.minRecoveryMs;

    // The cap applies after the min-dwell push, or a shot shorter than the
    // target would be dragged back down by it.
    const held = Math.min(Math.max(s.endT, s.startT + cfg.minDwellMs), s.startT + cfg.maxDwellMs);
    const endT = Math.min(held, latestEnd);
    if (endT - s.startT < floor) return;

    out.push({ ...s, endT });
  });

  return out;
}
