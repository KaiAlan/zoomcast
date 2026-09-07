import { describe, expect, it } from "vitest";
import { screenRect } from "../../shared/zoom/geometry";
import { NO_ZOOM } from "../../shared/zoom/interpolate";
import { screenQuad } from "./layout";

const HD = { w: 1920, h: 1080 };
const PAD = 0.85;

describe("screenQuad", () => {
  it("reduces exactly to screenRect at scale 1", () => {
    expect(screenQuad(HD, HD, PAD, NO_ZOOM)).toEqual(screenRect(HD, HD, PAD));
  });

  it("is continuous just above scale 1", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 1.0001, cx: 0.2, cy: 0.2 });
    expect(q.x).toBeCloseTo(base.x, 0);
    expect(q.y).toBeCloseTo(base.y, 0);
  });

  it("scales the quad by the zoom factor", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeCloseTo(base.w * 2, 5);
    expect(q.h).toBeCloseTo(base.h * 2, 5);
  });

  it("centres a centred focus point", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.x + q.w / 2).toBeCloseTo(HD.w / 2, 5);
    expect(q.y + q.h / 2).toBeCloseTo(HD.h / 2, 5);
  });

  it("clamps so an oversized quad never exposes background at an edge", () => {
    // focus hard left; the quad is wider than the output, so x must not go positive
    const q = screenQuad(HD, HD, PAD, { scale: 3, cx: 0, cy: 0.5 });
    expect(q.w).toBeGreaterThan(HD.w);
    expect(q.x).toBeLessThanOrEqual(0);
    expect(q.x + q.w).toBeGreaterThanOrEqual(HD.w);
  });

  it("keeps padding visible when the quad is still smaller than the output", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 1.1, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeLessThan(HD.w);
    expect(q.x).toBeGreaterThan(0);
  });

  it("moves the focus point toward the centre as scale grows", () => {
    const off = { cx: 0.2, cy: 0.5 };
    const base = screenRect(HD, HD, PAD);
    const focusAt = (scale: number): number => {
      const q = screenQuad(HD, HD, PAD, { ...off, scale });
      return q.x + off.cx * q.w;
    };
    const centre = HD.w / 2;
    const near = Math.abs(focusAt(1) - centre);
    const far = Math.abs(focusAt(1.5) - centre);
    expect(far).toBeLessThan(near);
    expect(base.w).toBeGreaterThan(0);
  });
});

/**
 * Three properties, because no one of them pins the clamp on its own.
 *
 * Continuity catches the bug that shipped: a clamp written as two gated
 * regimes collapsed to a zero-width range at exactly the crossover, pinning
 * the quad while the unclamped value was hundreds of pixels away, and
 * releasing one float later. Measured at 229px in a single frame.
 *
 * But continuity alone cannot catch a clamp that is simply MISSING — deleting
 * one is perfectly continuous, just wrong. So "covers" and "nested" pin what
 * the clamps are actually for, on both axes. A re-review proved the need: with
 * only continuity, deleting the y clamp entirely still passed.
 *
 * Sweeping both cx and cy matters for the same reason. cy = 0.5 is precisely
 * the case where the vertical clamp never binds.
 */
/**
 * Exhaustive sweeps, not samples: these are what hold the head-of-file jump
 * closed, and the discontinuity they caught was one float wide. They take a
 * couple of seconds alone and longer when the rest of the suite is running
 * beside them, so they get an explicit timeout — a guard that fails on load
 * rather than on regression is a guard people learn to ignore.
 */
describe("screenQuad clamping", { timeout: 60_000 }, () => {
  const CENTRES = [0, 0.05, 0.07005, 0.2, 0.5, 0.8, 0.95, 1];
  const OUTPUTS = [
    { name: "16:9 native", size: HD },
    { name: "9:16", size: { w: 608, h: 1080 } },
    { name: "1:1", size: { w: 1080, h: 1080 } },
    { name: "4:3", size: { w: 1440, h: 1080 } },
    { name: "wide banner", size: { w: 1920, h: 600 } },
  ];

  /** Past the ceiling too: the function must hold up beyond what a plan asks. */
  const scales = (output: { w: number; h: number }): number[] => {
    const ceiling = (HD.w / (output.w * PAD)) * 1.3;
    const steps = 400;
    return Array.from({ length: steps + 1 }, (_, i) => 1 + (i / steps) * (ceiling - 1));
  };

  it("never moves the quad far in one small step of scale", () => {
    for (const { name, size } of OUTPUTS) {
      for (const cx of CENTRES) {
        for (const cy of CENTRES) {
          let prev = screenQuad(HD, size, PAD, { scale: 1, cx, cy });

          for (const scale of scales(size)) {
            const q = screenQuad(HD, size, PAD, { scale, cx, cy });
            const moved = Math.hypot(q.x - prev.x, q.y - prev.y);

            // Loose against legitimate motion at this sweep density (worst
            // honest step measured at 5.1px), tight against the failure: the
            // bug moved 229px in a single frame.
            expect(
              moved,
              `${name} cx=${cx} cy=${cy} jumped ${moved.toFixed(1)}px at scale ${scale.toFixed(5)}`,
            ).toBeLessThan(30);
            prev = q;
          }
        }
      }
    }
  });

  it("reveals no background on an axis the quad covers", () => {
    for (const { name, size } of OUTPUTS) {
      for (const cx of CENTRES) {
        for (const cy of CENTRES) {
          for (const scale of scales(size)) {
            const q = screenQuad(HD, size, PAD, { scale, cx, cy });
            const slack = 1e-6;

            if (q.w >= size.w) {
              expect(q.x, `${name} cx=${cx} left edge`).toBeLessThanOrEqual(slack);
              expect(q.x + q.w, `${name} cx=${cx} right edge`).toBeGreaterThanOrEqual(size.w - slack);
            }
            if (q.h >= size.h) {
              expect(q.y, `${name} cy=${cy} top edge`).toBeLessThanOrEqual(slack);
              expect(q.y + q.h, `${name} cy=${cy} bottom edge`).toBeGreaterThanOrEqual(size.h - slack);
            }
          }
        }
      }
    }
  });

  it("keeps the quad inside the frame on an axis where it fits", () => {
    for (const { name, size } of OUTPUTS) {
      for (const cx of CENTRES) {
        for (const cy of CENTRES) {
          for (const scale of scales(size)) {
            const q = screenQuad(HD, size, PAD, { scale, cx, cy });
            const slack = 1e-6;

            if (q.w < size.w) {
              expect(q.x, `${name} cx=${cx} pokes off the left`).toBeGreaterThanOrEqual(-slack);
              expect(q.x + q.w, `${name} cx=${cx} pokes off the right`).toBeLessThanOrEqual(size.w + slack);
            }
            if (q.h < size.h) {
              expect(q.y, `${name} cy=${cy} pokes off the top`).toBeGreaterThanOrEqual(-slack);
              expect(q.y + q.h, `${name} cy=${cy} pokes off the bottom`).toBeLessThanOrEqual(size.h + slack);
            }
          }
        }
      }
    }
  });

  it("does not jump as the quad stops covering the output", () => {
    // The zoom-out's first eased frame lands a hair below the ceiling. Before
    // the fix this crossing moved the screen 229px right and 110px up on the
    // real take 2026-09-05T13-13-31 (cx 0.07005, cy 0.86782).
    const zoom = { cx: 0.07005, cy: 0.86782 };
    const ceiling = 1 / PAD;
    const at = screenQuad(HD, HD, PAD, { ...zoom, scale: ceiling });
    const justBelow = screenQuad(HD, HD, PAD, { ...zoom, scale: ceiling * (1 - 1e-7) });

    expect(Math.abs(justBelow.x - at.x)).toBeLessThan(1);
    expect(Math.abs(justBelow.y - at.y)).toBeLessThan(1);
  });
});
