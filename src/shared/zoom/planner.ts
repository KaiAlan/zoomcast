import type { TelemetryEvent } from "../bundle/types";
import { clusterImpulses, clusterIntent, mergeAndFilter } from "./cluster";
import { applyGuards, rateLimit } from "./guards";
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
    // Budget camera shots after chaining, not the clicks that guide a shot.
    false,
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
      endT: c.endT + cfg.trailMs + cfg.transitionOutMs,
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

  return rateLimit(applySegmentGuards(segments, cfg, ctx), cfg, ctx.durationMs,
    s => s.waypoints.length).map((s) => {
    const first = s.waypoints[0];

    return {
      // The cluster that produced the first waypoint, so replan can still
      // match a segment across a re-plan.
      id: `s${first?.id ?? "0"}`,
      startMs: s.startT,
      endMs: s.endT,
      // Keep the reading area stable, following cursor escapes automatically.
      position: "follow",
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
