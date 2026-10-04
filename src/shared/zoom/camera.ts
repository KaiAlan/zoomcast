import { buildCursorPath, cursorAt, type CursorPath } from "../cursor/path";
import type { TelemetryEvent } from "../bundle/types";
import { clamp, screenRect } from "./geometry";
import { focusBoundsFor, lateralAuthority, screenQuadFor } from "./viewport";
import type { PlanContext } from "./types";

/**
 * Filter small telemetry jitter before safe-area tracking. Actual camera
 * damping is separate and carries velocity in the safe-area follower below.
 */
export const CAMERA_HALF_LIFE_MS = 50;

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
 * This input filter does not inherit the drawn cursor's presentation settings.
 * The follower integrates its own damping on a fixed source-time grid.
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

export type Focus = { cx: number; cy: number };

/** Inner half of the rendered view: room to read before the camera travels. */
export const CAMERA_SAFE_INSET = 0.25;
const FOLLOW_FREQUENCY = 12; // rad/s; roughly 400ms to reach 95% of a step

/**
 * A shot-local camera with persistent target and velocity. Call in ascending
 * source time on the fixed grid, then store the returned positions as keyframes.
 * Targets use rendered geometry, including padding and output aspect.
 */
export function safeAreaFollower(initial: Focus, scale: number, ctx: PlanContext) {
  let target = clampToSource(initial, scale, ctx);
  let centre = { ...target };
  let vx = 0;
  let vy = 0;
  const base = screenRect(ctx.source, ctx.output, ctx.paddingFactor);
  const authority = lateralAuthority(scale, ctx.paddingFactor);
  const coefficient = (scale - 1 / scale) * authority;

  return (path: CursorPath, tMs: number, deltaMs: number): Focus => {
    const cursor = cursorAt(path, tMs);
    if (cursor !== null && coefficient > 0) {
      const quad = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, { scale, ...target });
      const adjust = (pixel: number, offset: number, span: number, output: number, baseSpan: number) => {
        // The source can be letterboxed on one axis. Use its visible portion.
        const left = Math.max(0, offset);
        const right = Math.min(output, offset + span);
        const inset = (right - left) * CAMERA_SAFE_INSET;
        const frame = offset + pixel * span;
        const nearest = clamp(frame, left + inset, right - inset);
        return (frame - nearest) / (baseSpan * coefficient);
      };
      target = clampToSource({
        cx: target.cx + adjust(cursor.x / ctx.source.w, quad.x, quad.w, ctx.output.w, base.w),
        cy: target.cy + adjust(cursor.y / ctx.source.h, quad.y, quad.h, ctx.output.h, base.h),
      }, scale, ctx);
    }
    const dt = Math.max(0, deltaMs) / 1000;
    // Limit long teleports to one view-width per second; small moves retain
    // the spring response. Limits are in rendered pixels, not source pixels.
    const x = dampedAxis(centre.cx, vx, target.cx, dt, coefficient > 0 ? ctx.output.w / (base.w * coefficient) : 0);
    const y = dampedAxis(centre.cy, vy, target.cy, dt, coefficient > 0 ? ctx.output.h / (base.h * coefficient) : 0);
    centre = clampToSource({ cx: x.value, cy: y.value }, scale, ctx);
    vx = centre.cx === x.value ? x.velocity : 0;
    vy = centre.cy === y.value ? y.velocity : 0;
    return centre;
  };
}

/** Closed-form critically damped response, including carried velocity. */
function dampedAxis(value: number, velocity: number, target: number, dt: number, maxSpeed: number) {
  const displacement = value - target;
  const b = velocity + FOLLOW_FREQUENCY * displacement;
  const decay = Math.exp(-FOLLOW_FREQUENCY * dt);
  const next = target + (displacement + b * dt) * decay;
  // A reversed target must not let old momentum carry the camera past it.
  if ((value < target && next > target) || (value > target && next < target)) {
    return { value: target, velocity: 0 };
  }
  const travel = next - value;
  if (Math.abs(travel) > maxSpeed * dt) {
    const speed = Math.sign(travel) * maxSpeed;
    return { value: value + speed * dt, velocity: speed };
  }
  return { value: next, velocity: (velocity - FOLLOW_FREQUENCY * b * dt) * decay };
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
