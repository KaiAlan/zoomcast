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
  let prevT = Number.NEGATIVE_INFINITY;

  for (const k of kfs) {
    if (tMs >= k.tSourceMs) {
      prev = { scale: k.scale, cx: k.cx, cy: k.cy };
      prevT = k.tSourceMs;
      continue;
    }

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

    return {
      scale: lerp(prev.scale, k.scale, e),
      cx: lerp(prev.cx, k.cx, e),
      cy: lerp(prev.cy, k.cy, e),
    };
  }

  return prev;
}
