import type { CursorPath } from "../cursor/path";
import type { Project } from "../project/types";
import { outputSizeFor } from "../style/aspect";
import type { TelemetryEvent } from "../bundle/types";
import { segmentsToKeyframes } from "./keyframes";
import { planZoom } from "./planner";
import { replan, replanSegments } from "./replan";
import type { PlanContext, Size, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

/**
 * Everything the two derivations need that does not live on the project.
 *
 * `cameraPath` is nullable because only `position: "follow"` segments read it;
 * the tune tool and the tests never build one.
 */
export type DeriveContext = {
  telemetry: TelemetryEvent[];
  cameraPath: CursorPath | null;
  source: Size;
  durationMs: number;
};

export type ZoomParts = { segments: ZoomSegment[]; keyframes: ZoomKeyframe[] };

export function planContextFor(project: Project, ctx: DeriveContext): PlanContext {
  return {
    source: ctx.source,
    // The zoom ceiling derives from the output size, so a re-plan after an
    // aspect change must see the new shape or it plans for the old one.
    output: outputSizeFor(project.output, ctx.source),
    paddingFactor: project.style.paddingFactor,
    durationMs: ctx.durationMs,
  };
}

/**
 * Telemetry -> segments -> keyframes. The full pass.
 *
 * Call this on load, and whenever a global dial moves: the pacing config or
 * the output aspect. It regenerates every segment the user has not claimed,
 * so it must NOT run in response to a direct segment edit.
 */
export function replanFrom(
  config: ZoomConfig,
  project: Project,
  ctx: DeriveContext,
): ZoomParts {
  const planCtx = planContextFor(project, ctx);
  const segments = replanSegments(
    project.zoom.segments,
    planZoom(ctx.telemetry, config, planCtx),
  );

  return {
    segments,
    keyframes: replan(
      project.zoom.keyframes,
      segmentsToKeyframes(segments, config, planCtx, ctx.cameraPath),
    ),
  };
}

/**
 * Segments -> keyframes. The half a direct edit needs.
 *
 * Keyframes are derived, so moving, resizing or re-depthing a segment must
 * rebuild them — but running the planner as well would walk the whole
 * telemetry array on every commit and re-derive every OTHER segment, so
 * dragging one shot could move its neighbours.
 */
export function deriveKeyframes(
  config: ZoomConfig,
  project: Project,
  ctx: DeriveContext,
): ZoomParts {
  const planCtx = planContextFor(project, ctx);

  return {
    segments: project.zoom.segments,
    keyframes: replan(
      project.zoom.keyframes,
      segmentsToKeyframes(project.zoom.segments, config, planCtx, ctx.cameraPath),
    ),
  };
}
