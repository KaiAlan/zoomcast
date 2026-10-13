import { alignSegmentsToClips, segmentPart } from "../project/clips";
import { clipsFor } from "../project/timeline";
import type { CursorPath } from "../cursor/path";
import type { Project } from "../project/types";
import { outputSizeFor } from "../style/aspect";
import type { TelemetryEvent } from "../bundle/types";
import { segmentsToKeyframes } from "./keyframes";
import { planZoom } from "./planner";
import { replan, replanSegments } from "./replan";
import { projectKeyframes } from "./viewport";
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
  const planned = replanSegments(
    project.zoom.segments,
    planZoom(ctx.telemetry, config, planCtx),
  );

  const segments = project.clips ? alignSegmentsToClips(planned, clipsFor(ctx.durationMs, project.cuts, project.clips)) : planned;
  const generated = segmentsToKeyframes(segments, config, planCtx, ctx.cameraPath);
  return {
    segments,
    keyframes: projectKeyframes(project.zoom.segments.length === 0 ? replan(project.zoom.keyframes, generated) : generated, planCtx),
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

  const segments = project.clips ? alignSegmentsToClips(project.zoom.segments, clipsFor(ctx.durationMs, project.cuts, project.clips)) : project.zoom.segments;
  return {
    segments,
    keyframes: projectKeyframes(segments.length === 0
      ? project.zoom.keyframes.filter(k => k.pinned || k.origin === "manual")
      : segmentsToKeyframes(segments, config, planCtx, ctx.cameraPath), planCtx),
  };
}

/** Reset this shot's camera and depth from telemetry without resurrecting deleted neighbours. */
export function resetShotToAuto(project: Project, id: string, ctx: DeriveContext): Project {
  const target = project.zoom.segments.find(s => s.id === id);
  if (!target) return project;
  const fresh = planZoom(ctx.telemetry, project.zoom.config, planContextFor(project, ctx));
  const automatic = fresh.filter(s => s.startMs < target.endMs && s.endMs > target.startMs)
    .sort((a, b) => Math.min(b.endMs, target.endMs) - Math.max(b.startMs, target.startMs)
      - (Math.min(a.endMs, target.endMs) - Math.max(a.startMs, target.startMs)))[0];
  const reset = automatic ? segmentPart(automatic, target.startMs, target.endMs, target.id) : {
    ...target, waypoints: target.waypoints.map(w => ({ ...w, depth: project.zoom.config.depthClick })),
  };
  return { ...project, zoom: { ...project.zoom, segments: project.zoom.segments.map(s => s.id === id
    ? { ...reset, origin: target.origin, pinned: false, position: "follow", cameraOverride: false } : s) } };
}
