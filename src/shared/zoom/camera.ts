import { buildCursorPath, type CursorPath } from "../cursor/path";
import type { TelemetryEvent } from "../bundle/types";
import { clamp, screenRect } from "./geometry";
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
 * Keep the viewport inside the source.
 *
 * Applied to the SMOOTHED path rather than the raw cursor, so approaching a
 * source edge decelerates the camera instead of sticking it against the wall.
 *
 * The visible fraction is not 1/scale: the quad is inset by paddingFactor
 * before it is scaled, so at the ceiling — where `screenRect(...).w * scale`
 * equals the output width — the whole source is visible and the only legal
 * centre is the middle. `screenQuad` clamps the same geometry in output space;
 * doing it here as well means the planned keyframes are already sane, so the
 * camera rides that clamp instead of being dragged by it.
 */
export function clampToSource(
  centre: { cx: number; cy: number },
  scale: number,
  ctx: PlanContext,
): { cx: number; cy: number } {
  const base = screenRect(ctx.source, ctx.output, ctx.paddingFactor);

  return {
    cx: clampAxis(centre.cx, ctx.output.w / (base.w * scale)),
    cy: clampAxis(centre.cy, ctx.output.h / (base.h * scale)),
  };
}

/**
 * The bound binds only while something is actually cropped.
 *
 * At the native output aspect nothing ever is: cropping would start above
 * `1 / paddingFactor`, which is exactly where `maxComfortableZoom` lands when
 * output matches source, so the whole source is on screen at every legal scale
 * and every centre is legal. Forcing 0.5 there would pin a follow camera to
 * the middle and make it inert. Cropping — and therefore panning freedom —
 * exists when the output crops the source: 1:1, 4:5, or an export smaller than
 * the capture. Below that threshold `screenQuad`'s own clamp is what keeps the
 * composition nested, and it is continuous.
 */
function clampAxis(v: number, visibleFraction: number): number {
  if (visibleFraction >= 1) return clamp(v, 0, 1);

  const half = visibleFraction / 2;
  return clamp(v, half, 1 - half);
}
