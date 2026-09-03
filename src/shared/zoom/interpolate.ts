import { EASINGS } from "./easing";
import type { ZoomKeyframe } from "./types";

export type ZoomState = { scale: number; cx: number; cy: number };

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

  for (const k of kfs) {
    if (tMs >= k.tSourceMs) {
      prev = { scale: k.scale, cx: k.cx, cy: k.cy };
      continue;
    }

    const transitionStart = k.tSourceMs - k.transitionMs;
    if (tMs <= transitionStart) return prev;

    const u = (tMs - transitionStart) / k.transitionMs;
    const e = EASINGS[k.easing](u);

    return {
      scale: lerp(prev.scale, k.scale, e),
      cx: lerp(prev.cx, k.cx, e),
      cy: lerp(prev.cy, k.cy, e),
    };
  }

  return prev;
}
