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
