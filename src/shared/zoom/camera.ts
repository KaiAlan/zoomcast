import { buildCursorPath, type CursorPath } from "../cursor/path";
import type { TelemetryEvent } from "../bundle/types";
import { clamp } from "./geometry";
import { focusBoundsFor } from "./viewport";
import type { PlanContext } from "./types";

/**
 * Camera-scale damping. An order of magnitude slower than the cursor's own
 * (90ms at most), which is the whole reason the two are separate inputs: the
 * cursor's smoothing is a presentation control the user can set to zero, and a
 * camera that inherited it would jitter.
 */
export const CAMERA_HALF_LIFE_MS = 300;

/** Samples per second of the precomputed path. */
export const CAMERA_SAMPLE_HZ = 120;

export type FollowOptions = { halfLifeMs?: number; sampleHz?: number };

/**
 * The follow camera's path: precomputed, never integrated per frame.
 *
 * This is the decision that makes parity hold. A per-frame simulation depends
 * on frame timing, so a 60fps preview and a 30fps export would produce
 * different paths and verify:parity would be right to fail. A precomputed path
 * is a pure function of telemetry and config — identical in both, and testable
 * with no renderer at all.
 *
 * The lag is exponential (one-pole), not a spring. Memoryless exponential
 * decay composes exactly across step sizes, so no-overshoot and
 * frame-rate-independence hold exactly rather than approximately. A spring
 * carries velocity state and gives neither for free, and an overshooting
 * camera looks broken.
 */
export function followPath(
  events: TelemetryEvent[],
  opts: FollowOptions = {},
): CursorPath {
  return buildCursorPath(events, {
    halfLifeMs: opts.halfLifeMs ?? CAMERA_HALF_LIFE_MS,
    sampleHz: opts.sampleHz ?? CAMERA_SAMPLE_HZ,
  });
}

/**
 * Keep the window covering the output.
 *
 * Derived from `screenQuadFor` rather than reimplemented: that is the quad the
 * renderer actually draws with, so it is the one that decides what is on
 * screen, and two copies of the clamp would be free to disagree. Applied to
 * the SMOOTHED path rather than the raw cursor, so approaching an edge
 * decelerates the camera instead of sticking it against the wall.
 *
 * The round trip is: build the quad for this centre, then read back which
 * source point the clamped quad puts at the output centre.
 */
export function clampToSource(
  centre: { cx: number; cy: number },
  scale: number,
  ctx: PlanContext,
): { cx: number; cy: number } {
  const b = focusBoundsFor(ctx.source, ctx.output, ctx.paddingFactor, scale);

  return {
    cx: clamp(centre.cx, b.x[0], b.x[1]),
    cy: clamp(centre.cy, b.y[0], b.y[1]),
  };
}
