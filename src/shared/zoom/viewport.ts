import { clamp, type Rect } from "./geometry";
import type { ZoomState } from "./interpolate";
import type { Size } from "./types";

/** A region of the source, normalised 0..1, top-left origin. */
export type SourceRect = { x: number; y: number; w: number; h: number };

/**
 * The region of the source the camera is looking at.
 *
 * This is the camera. The drawn frame is a constant (see `screenQuad`); zoom
 * moves and shrinks THIS instead. Before 2026-09-07 it was the other way
 * round — the frame grew until the output cropped it — which capped the whole
 * zoom range at 1/paddingFactor and left the camera with zero freedom at the
 * top of it. See docs/specs/2026-09-07-camera-geometry-and-depth-design.md §1.
 *
 * The clamp is written as ONE continuous range, `clamp(v, 0, 1 - w)`, never as
 * a gated branch. At scale 1 that range collapses to [0, 0], and it must
 * collapse smoothly: the identical bug in the old growing-quad clamp was
 * written as two cases, and released one float below the crossover, teleporting
 * the camera 229px. viewport.test.ts sweeps that boundary.
 */
export function sourceRectFor(zoom: ZoomState, frame: Rect, source: Size): SourceRect {
  // How much taller the sampled region must be than it is wide, in normalised
  // source units, for it to fill a frame of this aspect without distortion.
  // Exactly 1 while the frame carries the source's aspect, which the current
  // fitted frame guarantees — written out so a future crop mode cannot make it
  // silently wrong.
  const ratio = source.w / source.h / (frame.w / frame.h);

  // A scale below 1 is rest, not a zoom out: there is nothing outside the
  // source to show.
  let w = Math.min(1, 1 / Math.max(1, zoom.scale));
  let h = w * ratio;

  if (h > 1) {
    h = 1;
    w = h / ratio;
  }

  return {
    x: clamp(zoom.cx - w / 2, 0, 1 - w),
    y: clamp(zoom.cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/**
 * A point in the source, in output-space pixels — or null if it is not on
 * screen.
 *
 * The ONE mapping (invariant 5). The screen samples this region in the shader;
 * the cursor and the ripples map through this function. Three call sites each
 * carrying their own arithmetic is how they drift apart, and they agree today
 * only because they are all the identity.
 *
 * `p` and the result share one convention (invariant 10): top-left origin, y
 * increasing downward. There is no flip here — the only Y flip in the system
 * is in QUAD_VERT's gl_Position.
 */
export function sourceToFrame(
  p: { x: number; y: number },
  rect: SourceRect,
  frame: Rect,
): { x: number; y: number } | null {
  const u = (p.x - rect.x) / rect.w;
  const v = (p.y - rect.y) / rect.h;

  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  return { x: frame.x + u * frame.w, y: frame.y + v * frame.h };
}
