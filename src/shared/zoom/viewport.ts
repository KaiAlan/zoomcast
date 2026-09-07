import { clamp, screenRect, type Rect } from "./geometry";
import type { ZoomState } from "./interpolate";
import type { Size } from "./types";

/** A region of the source, normalised 0..1, top-left origin. */
export type SourceRect = { x: number; y: number; w: number; h: number };

/**
 * The screen quad: where the recording is drawn in output space, for a zoom.
 *
 * **The window grows and travels; it is not cropped.** Zoom scales the whole
 * composited window about the focus point and slides it so the focus
 * approaches the output centre. Above `1 / paddingFactor` the window is larger
 * than the output and bleeds off every edge — the background disappears, and
 * that is correct: it is what the reference this was measured against does.
 *
 * This inverts the 2026-09-07 rework, which made the frame a constant and
 * shrank the SAMPLED REGION instead. That rework's stated reason was that the
 * old growing quad "capped the whole zoom range at 1/paddingFactor and left
 * the camera with zero freedom at the top of it" — but that was the CAP, not
 * the model: `maxZoom` was derived from the padding. `maxZoom` is an
 * independent dial now (1.6, so the window reaches 1.36x the output), so the
 * growing model has all the room it needs. Third time this codebase has been
 * bitten by a cap it blamed on something else.
 *
 * Scale about the focus point, then pull the focus toward the output centre by
 * k = 1 - 1/scale. k is 0 at scale 1, so this reduces exactly to `screenRect`
 * and has no discontinuity when a zoom begins; as scale grows, k approaches 1
 * and the subject ends up centred.
 */
export function screenQuadFor(
  source: Size,
  output: Size,
  paddingFactor: number,
  zoom: ZoomState,
): Rect {
  const base = screenRect(source, output, paddingFactor);

  const w = base.w * zoom.scale;
  const h = base.h * zoom.scale;

  const focusX = base.x + zoom.cx * base.w;
  const focusY = base.y + zoom.cy * base.h;

  const k = 1 - 1 / zoom.scale;

  let x = focusX - zoom.cx * w + (output.w / 2 - focusX) * k;
  let y = focusY - zoom.cy * h + (output.h / 2 - focusY) * k;

  // Both bounds must be ONE continuous range. Gating on `w >= output.w`
  // instead makes the range [output.w - w, 0] collapse to zero width at
  // exactly w === output.w, pinning x to 0 there while the unclamped x is
  // hundreds of pixels away — and one float below the crossover the clamp
  // released and the camera teleported. Measured at 229px on a real take.
  // The continuity sweeps in viewport.test.ts are what hold this closed.
  x = clamp(x, Math.min(0, output.w - w), Math.max(0, output.w - w));
  y = clamp(y, Math.min(0, output.h - h), Math.max(0, output.h - h));

  return { x, y, w, h };
}

/**
 * The range of focus centres, per axis, that `screenQuadFor` will NOT clamp.
 *
 * Derived from the same expression the quad uses, so the two cannot drift.
 * Writing out x(cx) from `screenQuadFor`:
 *
 *   focus = b + cx*bw,  w = bw*scale,  k = 1 - 1/scale
 *   x = b + cx*bw + (out/2 - b - cx*bw)*k - cx*bw*scale
 *     = A + cx * bw * (1/scale - scale)
 *
 * with A = b + (out/2 - b)*k. The cx coefficient is negative for every
 * scale > 1, so x is monotonic in cx and the two clamp bounds invert into a
 * plain interval. This exists because clamping the quad is not a fixed point
 * in cx: reading a centre back off a clamped quad and feeding it in again
 * gives a different quad, so the follow path has to be clamped in cx directly.
 */
function focusRange(base: number, span: number, out: number, scale: number): [number, number] {
  const w = span * scale;
  const k = 1 - 1 / scale;
  const a = base + (out / 2 - base) * k;
  const d = span * (1 / scale - scale);

  if (d === 0) return [0.5, 0.5];

  const lo = (Math.min(0, out - w) - a) / d;
  const hi = (Math.max(0, out - w) - a) / d;

  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** Focus centres that keep the window covering the output, per axis. */
export function focusBoundsFor(
  source: Size,
  output: Size,
  paddingFactor: number,
  scale: number,
): { x: [number, number]; y: [number, number] } {
  const b = screenRect(source, output, paddingFactor);

  return {
    x: focusRange(b.x, b.w, output.w, scale),
    y: focusRange(b.y, b.h, output.h, scale),
  };
}

/** The whole source. The quad carries the zoom now, so the sampling is total. */
export const WHOLE_SOURCE: SourceRect = { x: 0, y: 0, w: 1, h: 1 };

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
