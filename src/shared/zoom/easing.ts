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
  zoomEase: cubicBezier(0.33, 0, 0.1, 1),
  linear: (x: number): number => Math.min(1, Math.max(0, x)),
};
