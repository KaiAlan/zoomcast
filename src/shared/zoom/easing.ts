import type { EasingName } from "./types";

/**
 * Standard CSS cubic-bezier solver: Newton-Raphson to invert x(t), then
 * evaluate y at the recovered parameter.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const a = (p1: number, p2: number): number => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number): number => 3 * p2 - 6 * p1;
  const c = (p1: number): number => 3 * p1;

  const curve = (t: number, p1: number, p2: number): number =>
    ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;

  const slope = (t: number, p1: number, p2: number): number =>
    3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (d === 0) break;
      t -= (curve(t, x1, x2) - x) / d;
    }

    return curve(t, y1, y2);
  };
}

export const EASINGS: Record<EasingName, (x: number) => number> = {
  /**
   * The original. Measured: 61% of the motion in the first third and 6% in the
   * last, with peak velocity at 23% of the way through. That shape is what
   * "floaty" describes — the camera arrives early and then drifts the last few
   * percent for 300ms, so the move reads as ongoing long after it is visually
   * over.
   */
  zoomEase: cubicBezier(0.33, 0, 0.1, 1),
  /**
   * Velocity peaks in the middle instead: 23% / 50% / 23% across the thirds,
   * and the lowest peak speed of the curves tried, so a longer transition does
   * not read as a slower one. Gentler at both ends, with no drifting tail.
   */
  zoomGlide: cubicBezier(0.45, 0.05, 0.55, 0.95),
  /**
   * Measured off a Recordly export, then confirmed in its source, where the
   * same curve is called `easeOutScreenStudio`.
   *
   * 90 / 9 / 1 across the thirds: it is 95% arrived after 648ms of a 1523ms
   * window and spends the remaining 875ms settling almost invisibly. That is
   * the opposite of the reasoning that made zoomGlide the default — a
   * drifting tail was blamed for "floaty" — and the reference says a long
   * tail is fine as long as the camera commits early and hard.
   */
  screenStudio: cubicBezier(0.16, 1, 0.3, 1),
  /**
   * For travelling between focus points inside one shot, not for zooming.
   *
   * Measured off Recordly, where it is `easeConnectedPan`: 65/28/7 across the
   * thirds against `screenStudio`'s 90/9/1, and a peak speed of 2.61x/s
   * against 4.09x/s. A pan wants to be gentler than a zoom — putting 90% of a
   * sideways camera move into its first third reads as a lurch.
   */
  cameraPan: cubicBezier(0.1, 0, 0.2, 1),
  linear: (x: number): number => Math.min(1, Math.max(0, x)),
};
