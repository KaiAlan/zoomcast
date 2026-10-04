import type { PlanContext, ZoomConfig } from "./types";
import { screenQuadFor } from "./viewport";

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
export function applySegmentGuards(
  segs: Segment[],
  cfg: ZoomConfig,
  /**
   * Needed only by `dropDoubleBacks`, which has to know what is on screen.
   * Without it that guard does not run — the same fallback `segmentsToKeyframes`
   * uses for a missing follow path, so callers that only care about timing (the
   * tune tool, most of segments.test.ts) need not build a context.
   */
  ctx: PlanContext | null = null,
): Segment[] {
  // Extend before merging: recovery is measured after the full rendered exit.
  // Otherwise a short click grows into its neighbour only after the merge
  // decision, producing an unnecessary out/in cycle.
  const merged = enforceDwell(mergeForRecovery(enforceDwell(segs, cfg), cfg), cfg)
    .map(s => ctx === null ? s : { ...s, endT: Math.min(s.endT, ctx.durationMs) });
  return ctx === null ? merged : dropDoubleBacks(merged, cfg, ctx);
}

/** Is a source point inside the frame the camera draws at this waypoint? */
function onScreen(ctx: PlanContext, w: Waypoint, px: number, py: number): boolean {
  const q = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, {
    scale: w.scale,
    cx: w.cx,
    cy: w.cy,
  });

  const x = q.x + (px / ctx.source.w) * q.w;
  const y = q.y + (py / ctx.source.h) * q.h;

  return x >= 0 && x <= ctx.output.w && y >= 0 && y <= ctx.output.h;
}

/**
 * Drop a waypoint the camera visits only to come straight back from.
 *
 * `mergeForRecovery` concatenates the waypoints of everything it merges, so a
 * travelling shot follows attention in the order attention moved — which is
 * correct, and on real footage doubles back constantly. Measured over the 13
 * takes on disk: 12 of 17 interior triples reverse direction, median detour
 * 728px, max 1652px.
 *
 * Most of those are fine. The camera sits at the middle waypoint for three to
 * five seconds, and a considered move followed by another considered move is
 * not a wobble. The ones that read badly are the ones where it barely arrives
 * before leaving again — measured on 2026-09-07T17-22-48 as
 * `cx 0.319 -> 0.608 -> 0.449`, 555px right and 305px back with 1064ms of rest
 * between them.
 *
 * So the test is rest, not reversal, and the threshold is the one a shot
 * already has to clear: the move in costs `panMs`, so what is left of the gap
 * must still be `minDwellMs`. No new constant.
 *
 * The visibility test is what makes dropping safe rather than merely tidier. A
 * dropped waypoint's activity has to be on screen from BOTH its neighbours, so
 * nothing the camera would have shown stops being shown — it is only the trip
 * that goes. Of the 12 reversals, 2 satisfy every condition.
 */
function dropDoubleBacks(segs: Segment[], cfg: ZoomConfig, ctx: PlanContext): Segment[] {
  return segs.map((s) => {
    // Dropping one waypoint gives its neighbours a new relationship, so this
    // repeats until nothing more comes out. Bounded by the list shrinking.
    let ws = s.waypoints;

    for (;;) {
      const next = dropOne(ws, cfg, ctx);
      if (next === ws) break;
      ws = next;
    }

    return ws === s.waypoints ? s : { ...s, waypoints: ws };
  });
}

/** One pass: the first waypoint that qualifies, removed. */
function dropOne(ws: Waypoint[], cfg: ZoomConfig, ctx: PlanContext): Waypoint[] {
  for (let i = 1; i < ws.length - 1; i += 1) {
    const a = ws[i - 1];
    const b = ws[i];
    const c = ws[i + 1];
    if (a === undefined || b === undefined || c === undefined) continue;

    const ax = a.cx * ctx.source.w;
    const ay = a.cy * ctx.source.h;
    const bx = b.cx * ctx.source.w;
    const by = b.cy * ctx.source.h;
    const cx = c.cx * ctx.source.w;
    const cy = c.cy * ctx.source.h;

    // Reversal: the leg out of b points back along the leg into it.
    if ((bx - ax) * (cx - bx) + (by - ay) * (cy - by) >= 0) continue;

    // Rest: what is left of the gap once the move out of b is paid for.
    if (c.t - b.t - cfg.panMs >= cfg.minDwellMs) continue;

    // Safety: b's activity must already be visible from both neighbours.
    if (!onScreen(ctx, a, bx, by) || !onScreen(ctx, c, bx, by)) continue;

    return [...ws.slice(0, i), ...ws.slice(i + 1)];
  }

  return ws;
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
      // Pay for this chain before deciding whether the next shot can rest.
      prev.endT = enforceDwell([prev], cfg)[0]?.endT ?? prev.endT;
      continue;
    }

    out.push({ ...s, waypoints: [...s.waypoints] });
  }

  return out;
}

/**
 * Give every arrival a real hold and pay for the full exit. Extend before
 * recovery merging so a short click cannot grow into a supposedly idle gap.
 * The second pass pays for the last pan of a chained shot. A recording may
 * truncate the result; keyframe emission then holds through its final frame.
 */
function enforceDwell(segs: Segment[], cfg: ZoomConfig): Segment[] {
  const floor = Math.max(cfg.transitionMs, cfg.zoomInOverlapMs) + cfg.transitionOutMs;
  const out: Segment[] = [];

  segs.forEach((s) => {
    let arrival = s.startT;
    for (const [i, w] of s.waypoints.entries()) {
      arrival = i === 0 ? Math.max(Math.max(s.startT, w.t) + cfg.transitionMs, s.startT + cfg.zoomInOverlapMs)
        : Math.max(w.t + cfg.panMs, arrival + Math.max(cfg.panMs, cfg.minWaypointGapMs));
    }
    const endT = Math.max(s.endT, arrival + Math.max(cfg.minDwellMs, cfg.minHoldMs) + cfg.transitionOutMs);
    if (endT - s.startT < floor) return;

    out.push({ ...s, endT });
  });

  return out;
}
