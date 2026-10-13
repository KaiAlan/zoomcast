import type { ZoomState } from "../zoom/interpolate";

/**
 * Directional motion blur strength from camera movement.
 *
 * The control law was measured off Recordly's zoomTransform.ts on 2026-09-07
 * and is recorded in
 * docs/specs/2026-09-08-preview-frame-source-split-design.md. Ours renders in
 * WebGL2 rather than pixi, so the filter is written here; this is the part
 * that took measurement.
 *
 * MUST be evaluated on the fixed grid, not per displayed frame. A per-frame
 * formulation makes a 60fps preview and a 30fps export produce different
 * blur and fails verify:parity — the same trap already noted for the cursor
 * spring in the 2026-09-07 camera-feel handoff.
 */
export type CameraSample = { x: number; y: number; scale: number };

/** Below this the blur is zero, or an idle camera shimmers. */
const DEADZONE_PX_PER_S = 15;
/** Speed at which the curve reaches full strength. */
const SPEED_SATURATION = 2000;
const MAX_BLUR_PX = 8;
/** Applied to the velocity vector before taking its angle. */
const DIRECTION_GAIN = 1.2;

export function blurAt(
  prev: CameraSample,
  next: CameraSample,
  dtMs: number,
  outputSize: { w: number; h: number },
  amount: number,
): { px: number; angleRad: number; kernel: number } {
  // A stalled frame must not spike the blur.
  const dt = Math.min(80, Math.max(1, dtMs)) / 1000;

  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dScale = next.scale - prev.scale;

  const velocity = Math.hypot(dx, dy) / dt;
  // Scale change counts as motion, so a pure zoom blurs too.
  const scaleSpeed = (Math.abs(dScale) * Math.max(outputSize.w, outputSize.h) * 0.5) / dt;
  const speed = velocity + scaleSpeed;

  if (speed < DEADZONE_PX_PER_S) {
    return { px: 0, angleRad: 0, kernel: 5 };
  }

  const normalised = Math.min(1, speed / SPEED_SATURATION);
  // Quadratic, so gentle moves get almost none.
  const px = normalised * normalised * MAX_BLUR_PX * amount;

  const angleRad = Math.atan2(dy * DIRECTION_GAIN, dx * DIRECTION_GAIN);

  const kernel = px < 2 ? 5 : px < 5 ? 9 : 11;

  return { px, angleRad, kernel };
}

/**
 * The fixed grid the blur is evaluated on.
 *
 * A CONSTANT, deliberately, and not the real elapsed frame time. Both the
 * preview and the export sample the camera at `t` and `t - BLUR_GRID_MS`, so
 * the blur is a pure function of source time and identical in both -- which is
 * what verify:parity requires. Using real elapsed time would make a 60fps
 * preview and a 30fps export disagree.
 */
export const BLUR_GRID_MS = 1000 / 60;

/**
 * Blur for the camera at one source time, or undefined when it is off.
 *
 * Takes the normalised zoom centres the planner produces and converts them to
 * output pixels, which is the space the control law is calibrated in.
 * Returning undefined at zero amount keeps the default configuration
 * bit-identical to before the feature existed.
 */
export function blurForCamera(
  prev: ZoomState,
  next: ZoomState,
  outputSize: { w: number; h: number },
  amount: number,
): { px: number; angleRad: number; kernel: number } | undefined {
  if (amount <= 0) return undefined;

  const position = (state: ZoomState) => ({
    x: state.quad === undefined ? state.cx * outputSize.w : state.quad.x + state.quad.w / 2,
    y: state.quad === undefined ? state.cy * outputSize.h : state.quad.y + state.quad.h / 2,
    scale: state.scale,
  });

  const blur = blurAt(
    position(prev),
    position(next),
    BLUR_GRID_MS,
    outputSize,
    amount,
  );

  return blur.px > 0 ? blur : undefined;
}
