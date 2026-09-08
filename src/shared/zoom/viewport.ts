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
/**
 * How much of the intended off-centre framing the camera is allowed to use, at
 * a given scale.
 *
 * Below `1 / paddingFactor` the window is SMALLER than the output: it floats
 * inside the frame, and `screenQuadFor`'s clamp holds it there so background
 * cannot appear on one side. In that regime the clamp, not the camera, decides
 * where the window sits — and because the bound moves as the window grows, the
 * effective centre drifted one way and then snapped back the other. Measured
 * on real takes: a 28.8px lateral reversal in the middle of a zoom-in, which
 * reads as the camera taking a couple of sideways steps on its way in.
 *
 * So the camera stays centred while it cannot pan, and takes up its framing
 * over a short ramp once the window covers the output. Same measurement after:
 * worst reversal 2.2px, which is below noticing on a 1920-wide frame.
 *
 * Attenuating cx rather than post-clamping x is what makes it monotonic: the
 * clamp then never binds during a zoom-in, so there is no bound left to fight.
 */
const LATERAL_RAMP = 0.2;

export function lateralAuthority(scale: number, paddingFactor: number): number {
  const cover = 1 / paddingFactor;
  return Math.min(1, Math.max(0, (scale - cover) / (cover * LATERAL_RAMP)));
}

export function screenQuadFor(
  source: Size,
  output: Size,
  paddingFactor: number,
  zoom: ZoomState,
): Rect {
  const base = screenRect(source, output, paddingFactor);

  const w = base.w * zoom.scale;
  const h = base.h * zoom.scale;

  // See lateralAuthority: while the window is smaller than the output it
  // cannot pan, and letting it try is what made the camera step sideways.
  const f = lateralAuthority(zoom.scale, paddingFactor);
  const cx = 0.5 + (zoom.cx - 0.5) * f;
  const cy = 0.5 + (zoom.cy - 0.5) * f;

  const focusX = base.x + cx * base.w;
  const focusY = base.y + cy * base.h;

  const k = 1 - 1 / zoom.scale;

  let x = focusX - cx * w + (output.w / 2 - focusX) * k;
  let y = focusY - cy * h + (output.h / 2 - focusY) * k;

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

  // screenQuadFor attenuates cx by lateralAuthority before using it, so the
  // range of INPUT cx that survives unclamped is the attenuated range widened
  // by 1/f. At f = 0 every cx maps to 0.5, so the honest answer is the fixed
  // point rather than an open range: a follow path there has nowhere to pan,
  // and reporting otherwise would let it chase a centre the quad ignores.
  const f = lateralAuthority(scale, paddingFactor);
  const widen = ([lo, hi]: [number, number]): [number, number] =>
    f <= 0 ? [0.5, 0.5] : [0.5 + (lo - 0.5) / f, 0.5 + (hi - 0.5) / f];

  return {
    x: widen(focusRange(b.x, b.w, output.w, scale)),
    y: widen(focusRange(b.y, b.h, output.h, scale)),
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
