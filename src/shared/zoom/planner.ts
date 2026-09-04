import type { TelemetryEvent } from "../bundle/types";
import { clusterImpulses, mergeAndFilter } from "./cluster";
import { fitScale } from "./geometry";
import { applyGuards } from "./guards";
import { toImpulses } from "./impulses";
import { applySegmentGuards, type Segment } from "./segments";
import type { PlanContext, ZoomConfig, ZoomKeyframe } from "./types";

/**
 * Turn telemetry into an editable zoom plan.
 *
 * The output is a plain keyframe list, not a live effect. The planner does not
 * need to be right — it needs to be close and correctable, which is what makes
 * this tractable at all.
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
): ZoomKeyframe[] {
  const clusters = applyGuards(
    mergeAndFilter(clusterImpulses(toImpulses(events, cfg), cfg), cfg),
    cfg,
    ctx.durationMs,
  );

  const segments: Segment[] = [];

  for (const c of clusters) {
    const scale = fitScale(c, cfg, ctx);
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

  const kfs: ZoomKeyframe[] = [];

  for (const s of applySegmentGuards(segments, cfg)) {
    for (const w of s.waypoints) {
      kfs.push({
        id: `${w.id}i`,
        tSourceMs: w.t,
        scale: w.scale,
        cx: w.cx,
        cy: w.cy,
        easing: cfg.easing,
        transitionMs: cfg.transitionMs,
        origin: "auto",
        pinned: false,
      });
    }

    const last = s.waypoints[s.waypoints.length - 1];
    if (last === undefined) continue;

    kfs.push({
      id: `${last.id}o`,
      tSourceMs: s.endT,
      scale: 1,
      cx: last.cx,
      cy: last.cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });
  }

  return kfs.sort((a, b) => a.tSourceMs - b.tSourceMs);
}
