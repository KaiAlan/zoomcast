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

    // Keep Newton inside a bracket. Flat x tangents can otherwise send it
    // outside [0, 1], producing non-monotonic camera motion near endpoints.
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      const error = curve(t, x1, x2) - x;
      if (Math.abs(error) < 1e-9) break;
      if (error > 0) hi = t;
      else lo = t;
      const d = slope(t, x1, x2);
      const next = d > 1e-8 ? t - error / d : NaN;
      t = next > lo && next < hi ? next : (lo + hi) / 2;
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
   * Historical preset, measured off a Recordly export. Recordly's current
   * easeOutZoom uses these coefficients; Screen Studio does not publish its
   * own coefficients. Recordly also applies a spring after this target.
   *
   * 90 / 9 / 1 across the thirds: it is 95% arrived after 648ms of a 1523ms
   * window and spends the remaining 875ms settling almost invisibly. That is
   * the opposite of the reasoning that made zoomGlide the default — a
   * drifting tail was blamed for "floaty" — and the reference says a long
   * tail is fine as long as the camera commits early and hard.
   */
  screenStudio: cubicBezier(0.16, 1, 0.3, 1),
  /** Symmetric pan: leave and arrive at rest without a sideways lurch. */
  cameraPan: cubicBezier(0.42, 0, 0.58, 1),
  /** Recovery opens gently and settles faster than the expressive push-in. */
  cameraExit: cubicBezier(0.3, 0, 0.3, 1),
  /** A non-oscillating push followed by a long, quiet settle. */
  cameraZoom: settledResponse,
  linear: (x: number): number => Math.min(1, Math.max(0, x)),
};

/**
 * Unit step response of a critically damped oscillator, evaluated directly.
 * A small eighth-power correction closes the finite window at zero velocity.
 * This gives an early velocity peak without a nonzero departure velocity or
 * a per-frame simulation; seeking and exports evaluate the identical curve.
 */
function settledResponse(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  const frequency = 6;
  const end = Math.exp(-frequency);
  const correction = frequency * frequency * end / 8;
  return (1 - (1 + frequency * u) * Math.exp(-frequency * u)
    - correction * u ** 8) / (1 - (1 + frequency) * end - correction);
}
