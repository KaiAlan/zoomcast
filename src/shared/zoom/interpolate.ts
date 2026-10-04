import { EASINGS } from "./easing";
import type { ZoomKeyframe } from "./types";
import type { Rect } from "./geometry";

export type ZoomState = { scale: number; cx: number; cy: number; quad?: Rect };

export const NO_ZOOM: ZoomState = { scale: 1, cx: 0.5, cy: 0.5 };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Sample the zoom state at a source time.
 *
 * A keyframe's `transitionMs` is the transition INTO it: the previous value
 * holds until `tSourceMs - transitionMs`, then eases to this keyframe.
 */
export function zoomAt(kfs: ZoomKeyframe[], tMs: number): ZoomState {
  if (kfs.length === 0) return NO_ZOOM;

  let prev: ZoomState = NO_ZOOM;
  let prevT = Number.NEGATIVE_INFINITY;

  // Upper bound: exact timestamps select the last keyframe at that time.
  // Follow shots can contain thousands of samples, so avoid scanning the
  // entire recording for every preview/export frame.
  let lo = 0;
  let hi = kfs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((kfs[mid]?.tSourceMs ?? Infinity) <= tMs) lo = mid + 1;
    else hi = mid;
  }
  const previous = kfs[lo - 1];
  if (previous !== undefined) {
    prev = { scale: previous.scale, cx: previous.cx, cy: previous.cy };
    if (previous.quad !== undefined) prev.quad = previous.quad;
    prevT = previous.tSourceMs;
  }
  const k = kfs[lo];
  if (k !== undefined) {

    // A transition may not begin before the keyframe it departs from.
    //
    // Without this clamp the window simply ran back past the previous
    // keyframe, so at the instant the camera should have ARRIVED there it was
    // already part-way to the next one — the value jumped, and the closer the
    // pair the bigger the jump. Measured on real takes: 9 of 134 transitions
    // overlapped, including a 1000ms pan across a 260ms gap and repeated
    // 1000ms zoom-outs starting 650ms after the final waypoint.
    //
    // The transition is shortened rather than the keyframe moved, because
    // `zoomAt` must stay a pure function of the keyframes it is handed —
    // including ones hand-written into project.json.
    const transitionStart = Math.max(k.tSourceMs - k.transitionMs, prevT);
    if (tMs <= transitionStart) return prev;

    const window = k.tSourceMs - transitionStart;
    const u = window <= 0 ? 1 : (tMs - transitionStart) / window;
    const e = EASINGS[k.easing](u);
    const fromQuad = prev.quad ?? (previous === undefined ? k.restQuad : undefined);

    return {
      scale: lerp(prev.scale, k.scale, e),
      cx: lerp(prev.cx, k.cx, e),
      cy: lerp(prev.cy, k.cy, e),
      // Interpolate the actual rendered rectangle. Applying the scale-dependent
      // framing ramp AFTER interpolating focus moves content away from its
      // target, then back, even when scale and focus are individually monotonic.
      ...(fromQuad !== undefined && k.quad !== undefined ? { quad: {
        x: lerp(fromQuad.x, k.quad.x, e), y: lerp(fromQuad.y, k.quad.y, e),
        w: lerp(fromQuad.w, k.quad.w, e), h: lerp(fromQuad.h, k.quad.h, e),
      } } : {}),
    };
  }

  return prev;
}
