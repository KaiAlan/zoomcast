import type { TelemetryEvent } from "../bundle/types";
import { clusterImpulses, mergeAndFilter } from "./cluster";
import { fitScale } from "./geometry";
import { applyGuards } from "./guards";
import { toImpulses } from "./impulses";
import type { PlanContext, ZoomConfig, ZoomKeyframe } from "./types";

/**
 * Turn telemetry into an editable zoom plan.
 *
 * The output is a plain keyframe list, not a live effect. The planner does not
 * need to be right — it needs to be close and correctable, which is what makes
 * this tractable at all.
 */
export function planZoom(
  events: TelemetryEvent[],
  cfg: ZoomConfig,
  ctx: PlanContext,
): ZoomKeyframe[] {
  const clusters = applyGuards(
    mergeAndFilter(clusterImpulses(toImpulses(events, cfg), cfg), cfg),
    cfg,
  );

  const kfs: ZoomKeyframe[] = [];

  for (const c of clusters) {
    const scale = fitScale(c, cfg, ctx);
    if (scale <= 1.0001) continue;

    const cx = c.cx / ctx.source.w;
    const cy = c.cy / ctx.source.h;

    kfs.push({
      id: `k${c.anchorIndex}i`,
      tSourceMs: Math.max(0, c.startT - cfg.leadInMs),
      scale,
      cx,
      cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });

    kfs.push({
      id: `k${c.anchorIndex}o`,
      tSourceMs: c.endT + cfg.trailMs,
      scale: 1,
      cx,
      cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });
  }

  return kfs.sort((a, b) => a.tSourceMs - b.tSourceMs);
}
