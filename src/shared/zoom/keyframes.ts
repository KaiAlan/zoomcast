import type { CursorPath } from "../cursor/path";
import { clampToSource, safeAreaFollower } from "./camera";
import type { PlanContext, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";
import { projectKeyframes } from "./viewport";
import { EASINGS } from "./easing";

/** Fixed source-time grid, independent of preview/export frame rate. */
export const FOLLOW_SAMPLE_MS = 1000 / 60;

/**
 * Segments cover the whole camera move, from departure to return to rest.
 * A waypoint marks the start of a focus move; keyframes mark its arrival.
 * Keeping those times separate avoids subtracting the entrance duration from
 * a click that already had lead-in applied.
 */
export function segmentsToKeyframes(
  segments: ZoomSegment[],
  cfg: ZoomConfig,
  ctx: PlanContext,
  follow: CursorPath | null = null,
): ZoomKeyframe[] {
  const kfs: ZoomKeyframe[] = [];
  for (const s of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    const start = Math.max(0, s.startMs);
    const end = Math.min(s.endMs, ctx.durationMs);
    // Do not start leaving early just to reach rest on the last video frame.
    // A shot still active at the end of the take finishes zoomed in.
    const hasExit = s.endMs < ctx.durationMs;
    const exitStart = hasExit ? end - cfg.transitionOutMs : end;
    if (exitStart <= start) continue;

    const moves: ZoomKeyframe[] = [];
    const waypoints = [...s.waypoints].sort((a, b) => a.tMs - b.tMs);
    // A generated follow shot already travels continuously with the cursor.
    // Reinserting a scripted pan at every click would stop its velocity and
    // restart the movement, and could pump depth during a typing run.
    const automaticFollow = s.position === "follow" && follow !== null
      && s.origin === "auto" && !s.pinned && !s.cameraOverride;
    for (const [i, w] of (automaticFollow ? waypoints.slice(0, 1) : waypoints).entries()) {
      const previous = moves[moves.length - 1];
      const duration = i === 0 ? cfg.transitionMs : cfg.panMs;
      const departure = i === 0 ? Math.max(start, w.tMs) : Math.max(start, w.tMs,
        (previous?.tSourceMs ?? start) + Math.max(0, cfg.minWaypointGapMs - duration));
      const arrival = i === 0 ? Math.max(departure + duration, start + cfg.zoomInOverlapMs) : departure + duration;
      // A manually shortened segment may shorten its entrance, but never start
      // before its own boundary or emit a target beyond its exit.
      const settle = i === 0 ? Math.min(arrival, exitStart) : arrival;
      if (settle > exitStart || settle <= start) continue;
      const scale = depthToScale(w.depth, cfg.maxZoom);
      // Arrive at the click anchor, then track escapes from that reading area.
      const centre = clampToSource({ cx: w.cx, cy: w.cy }, scale, ctx);
      moves.push({ id: `${w.id}i`, tSourceMs: settle, scale, ...centre,
        easing: i === 0 ? cfg.easing : "cameraPan",
        transitionMs: settle - departure,
        origin: s.origin, pinned: s.pinned });
    }
    if (moves.length === 0) continue;

    for (const [i, move] of moves.entries()) {
      if (s.position !== "follow" || follow === null) { kfs.push(move); continue; }
      const next = moves[i + 1];
      const until = next === undefined ? exitStart : next.tSourceMs - next.transitionMs;
      const track = safeAreaFollower(move, move.scale, ctx);
      if (automaticFollow && i === 0) {
        // Carry the same follower through the entrance and hold. Arriving at
        // a stale click and only THEN noticing a cursor escape caused another
        // sideways move immediately after every entrance.
        const departure = move.tSourceMs - move.transitionMs;
        kfs.push({ ...move, id: `${move.id}e0`, tSourceMs: departure, scale: 1,
          entrance: { scale: move.scale, progress: 0 }, easing: "linear", transitionMs: 0 });
        const trackStart = departure + Math.min(400, move.transitionMs / 3);
        let previous = departure;
        for (let n = 1; previous < move.tSourceMs; n++) {
          const t = Math.min(departure + n * FOLLOW_SAMPLE_MS, move.tSourceMs);
          const halfway = (previous + t) / 2;
          track(follow, halfway, Math.max(0, halfway - Math.max(previous, trackStart)));
          const centre = track(follow, t, Math.max(0, t - Math.max(halfway, trackStart)));
          const progress = EASINGS[move.easing]((t - departure) / move.transitionMs);
          const last = t === move.tSourceMs;
          kfs.push({ ...move, id: last ? move.id : `${move.id}e${n}`, tSourceMs: t,
            scale: 1 + (move.scale - 1) * progress, ...centre,
            ...(last ? {} : { entrance: { scale: move.scale, progress } }),
            easing: "linear", transitionMs: t - previous });
          previous = t;
        }
      } else kfs.push(move);
      // Follow during EVERY hold, up to the exact boundary of the next move.
      // Ending the grid early leaves a visible pause before each pan/exit.
      let previousT = move.tSourceMs;
      for (let n = 1; previousT < until; n++) {
        const t = Math.min(move.tSourceMs + n * FOLLOW_SAMPLE_MS, until);
        // Integrate at 120Hz independently of the keyframe/output sample rate.
        const halfway = (previousT + t) / 2;
        // Ease tracking velocity to rest before recovery instead of abruptly
        // freezing a travelling camera on the first zoom-out frame.
        const release = (time: number) => next === undefined && hasExit
          ? Math.min(1, Math.max(0, (until - time) / 200)) : 1;
        track(follow, halfway, (halfway - previousT) * release(halfway));
        kfs.push({ ...move, id: `${move.id}f${n}`, tSourceMs: t,
          ...track(follow, t, (t - halfway) * release(t)),
          easing: "linear", transitionMs: t - previousT });
        previousT = t;
      }
    }
    if (!hasExit) continue;
    const last = kfs[kfs.length - 1];
    if (last === undefined) continue;
    kfs.push({ id: `${s.waypoints[s.waypoints.length - 1]?.id ?? s.id}o`,
      tSourceMs: end, scale: 1, cx: last.cx, cy: last.cy,
      easing: cfg.easing === "cameraZoom" ? "cameraExit" : cfg.easing,
      transitionMs: cfg.transitionOutMs,
      origin: s.origin, pinned: s.pinned });
  }
  return projectKeyframes(kfs.sort((a, b) => a.tSourceMs - b.tSourceMs), ctx);
}

export function depthToScale(depth: number, ceiling: number): number {
  return 1 + Math.min(1, Math.max(0, depth)) * (ceiling - 1);
}

export function scaleToDepth(scale: number, ceiling: number): number {
  return ceiling <= 1 ? 0 : (scale - 1) / (ceiling - 1);
}
