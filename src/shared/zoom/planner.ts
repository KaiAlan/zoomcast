import type { TelemetryEvent } from "../bundle/types";
import { clusterImpulses, clusterIntent, mergeAndFilter } from "./cluster";
import { applyGuards } from "./guards";
import { depthConfigFrom, zoomDepth } from "./depth";
import { toImpulses } from "./impulses";
import { scaleToDepth } from "./keyframes";
import { applySegmentGuards, type Segment } from "./segments";
import type { PlanContext, ZoomConfig, ZoomSegment } from "./types";

/**
 * Turn telemetry into an editable zoom plan.
 *
 * The output is a plain segment list, not a live effect. The planner does not
 * need to be right — it needs to be close and correctable, which is what makes
 * this tractable at all. Keyframes are derived from these by
 * `segmentsToKeyframes`; segments are what is persisted and edited.
 *
 * Clusters become segments before they become keyframes, because the two
 * things that actually make auto-zoom unwatchable — a zoom too short to arrive,
 * and a zoom-out immediately followed by a zoom-in — are only visible once the
 * camera times exist. See segments.ts.
 */
export function planZoom(
  events: TelemetryEvent[],
  cfg: ZoomConfig,
  ctx: PlanContext,
): ZoomSegment[] {
  const clusters = applyGuards(
    mergeAndFilter(clusterImpulses(toImpulses(events, cfg), cfg), cfg),
    cfg,
    ctx.durationMs,
  );

  const segments: Segment[] = [];
  const depthCfg = depthConfigFrom(cfg);

  for (const c of clusters) {
    const scale = zoomDepth(
      {
        intent: clusterIntent(c, depthCfg),
        // Normalised per axis, so the rule does not depend on the capture's
        // resolution: a 4K take grades the same way a 1080p one does.
        spread: {
          x: (c.maxX - c.minX) / ctx.source.w,
          y: (c.maxY - c.minY) / ctx.source.h,
        },
      },
      depthCfg,
    );

    // Activity spread across most of the screen resolves to 1 and earns no
    // camera move at all, which is intended: there is nothing to zoom into.
    if (scale <= 1.0001) continue;

    segments.push({
      startT: Math.max(0, c.startT - cfg.leadInMs),
      endT: c.endT + cfg.trailMs,
      waypoints: [
        {
          id: `k${c.anchorIndex}`,
          t: Math.max(0, c.startT - cfg.leadInMs),
          scale,
          cx: c.cx / ctx.source.w,
          cy: c.cy / ctx.source.h,
        },
      ],
    });
  }

  const ceiling = cfg.maxZoom;

  return payForTheOpeningMove(applySegmentGuards(segments, cfg), cfg).map((s) => {
    const first = s.waypoints[0];

    return {
      // The cluster that produced the first waypoint, so replan can still
      // match a segment across a re-plan.
      id: `s${first?.id ?? "0"}`,
      startMs: s.startT,
      endMs: s.endT,
      // Follow is opt-in; the planner never chooses it.
      position: "fixed",
      waypoints: s.waypoints.map((w) => ({
        id: w.id,
        tMs: w.t,
        depth: scaleToDepth(w.scale, ceiling),
        cx: w.cx,
        cy: w.cy,
      })),
      origin: "auto",
      pinned: false,
    };
  });
}

/**
 * A zoom that opens the take has to pay for its own arrival.
 *
 * Decision 2 moves any keyframe whose transition would start before zero to
 * `transitionMs`, so the take opens at rest instead of on a hard cut
 * (`openAtRest` in keyframes.ts enforces that for every segment, including
 * hand-made ones). Doing only that silently shortens the opening zoom: the
 * camera now arrives 600ms later while still leaving at the same time, which
 * on the 26.8s take took the shortest hold to 1.04s — under the
 * `transitionMs * 2` floor `enforceDwell` exists to keep.
 *
 * So the segment pays for the move by ending later too, up to the recovery gap
 * the next segment needs. That keeps arrival-to-departure where the guards
 * were tuned to put it, and keeps the zoom count unchanged.
 */
function payForTheOpeningMove(segs: Segment[], cfg: ZoomConfig): Segment[] {
  const out: Segment[] = [];

  segs.forEach((s, i) => {
    const first = s.waypoints[0];
    if (first === undefined || first.t >= cfg.transitionMs) {
      out.push(s);
      return;
    }

    const shift = cfg.transitionMs - first.t;
    const next = segs[i + 1];
    const latestEnd = next === undefined ? Infinity : next.startT - cfg.minRecoveryMs;
    const endT = Math.min(s.endT + shift, latestEnd);

    // The compensation is clamped by the next segment's recovery gap, so a
    // close-following cluster can truncate it to nothing — and this runs AFTER
    // applySegmentGuards, so the dwell floor has already had its say. Measure
    // from the MOVED waypoint, which is where the camera actually arrives, and
    // drop a shot with no room to leave.
    //
    // It only started mattering when transitionMs went from 600 to 1500: the
    // shift is that much bigger, and `tune` showed a 0.71s opening zoom
    // against a 1.0s zoom-out. Dropping it opens the take at rest, which is
    // what the reference footage does anyway.
    if (endT - cfg.transitionMs < cfg.transitionOutMs) return;

    out.push({
      startT: s.startT,
      endT,
      waypoints: s.waypoints.map((w) => ({ ...w, t: Math.max(w.t, cfg.transitionMs) })),
    });
  });

  return out;
}
