import { describe, expect, it } from "vitest";
import { screenRect } from "./geometry";
import { sourceRectFor, sourceToFrame, type SourceRect } from "./viewport";
import type { Size } from "./types";

const SOURCE: Size = { w: 1920, h: 1080 };
const PAD = 0.85;
const frameFor = (output: Size) => screenRect(SOURCE, output, PAD);

const at = (scale: number, cx = 0.5, cy = 0.5, output: Size = SOURCE): SourceRect =>
  sourceRectFor({ scale, cx, cy }, frameFor(output), SOURCE);

describe("sourceRectFor", () => {
  it("shows the whole source at rest (invariant 4)", () => {
    expect(at(1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("samples 1/scale of the source", () => {
    expect(at(2).w).toBeCloseTo(0.5, 12);
    expect(at(1.6).w).toBeCloseTo(1 / 1.6, 12);
  });

  it("preserves the frame's aspect ratio (invariant 3)", () => {
    for (const output of [SOURCE, { w: 1080, h: 1080 }, { w: 1280, h: 720 }]) {
      const frame = frameFor(output);
      const r = sourceRectFor({ scale: 1.5, cx: 0.5, cy: 0.5 }, frame, SOURCE);
      const sampled = (r.w * SOURCE.w) / (r.h * SOURCE.h);
      expect(sampled).toBeCloseTo(frame.w / frame.h, 9);
    }
  });

  it("never leaves the source (invariant 2)", () => {
    for (const cx of [-1, 0, 0.5, 1, 2]) {
      const r = at(1.6, cx, cx);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("centres on the requested point when there is room", () => {
    const r = at(2, 0.5, 0.5);
    expect(r.x).toBeCloseTo(0.25, 12);
    expect(r.y).toBeCloseTo(0.25, 12);
  });

  it("treats a scale below 1 as rest rather than zooming out", () => {
    expect(at(0.5)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

/**
 * The bound is derived, not guessed: w = 1/s so |dw/ds| = 1/s² <= 1 for
 * s >= 1; x = cx - w/2 gives |dx/ds| <= 0.5 and |dx/dcx| <= 1; and clamping is
 * 1-Lipschitz, so it can only ever reduce movement. K = 2 is therefore a safe
 * bound with margin. On a 1920px source it caps movement at ~4px per 0.001 of
 * scale — against the 229px the original bug produced.
 *
 * The comparison is between ADJACENT SAMPLES ON THE GRID, not between a grid
 * point and itself plus some tiny epsilon. That distinction is the whole test:
 * an epsilon pair only straddles a discontinuity that happens to lie within
 * epsilon of a grid point, so a jump sitting between two grid points is never
 * crossed and never seen. Consecutive samples straddle every point in between,
 * which is what makes this a Lipschitz check rather than a spot check. Verified
 * by mutation: gating the clamp on `w > 0.9` passes the epsilon version and
 * fails this one.
 */
describe("continuity (invariant 7)", { timeout: 120_000 }, () => {
  const K = 2;
  const SCALE_STEP = 0.005;
  const CENTRE_STEP = 0.01;
  const EPS = 1e-4;
  const OUTPUTS: Size[] = [SOURCE, { w: 1080, h: 1080 }, { w: 1280, h: 720 }];
  const MAX_ZOOM = 2.5; // past any configured ceiling: the function must hold up

  const dist = (a: SourceRect, b: SourceRect): number =>
    Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.w - b.w),
      Math.abs(a.h - b.h),
    );

  /** Every boundary where a clamp can begin or stop binding. */
  const boundaries = (scale: number): number[] => {
    const half = 1 / (2 * scale);
    return [0, half, 1 - half, 1];
  };

  it("never jumps between adjacent scales", () => {
    const allowed = K * SCALE_STEP + 1e-9;

    for (const output of OUTPUTS) {
      for (const cx of [0, 0.05, 0.2, 0.5, 0.8, 0.95, 1]) {
        for (let s = 1; s <= MAX_ZOOM; s += SCALE_STEP) {
          const a = at(s, cx, cx, output);
          const b = at(s + SCALE_STEP, cx, cx, output);
          expect(dist(a, b)).toBeLessThanOrEqual(allowed);
        }
      }
    }
  });

  it("never jumps between adjacent centres", () => {
    const allowed = K * CENTRE_STEP + 1e-9;

    for (const output of OUTPUTS) {
      for (let s = 1; s <= MAX_ZOOM; s += 0.05) {
        for (let cx = 0; cx <= 1; cx += CENTRE_STEP) {
          const a = at(s, cx, cx, output);
          const b = at(s, cx + CENTRE_STEP, cx + CENTRE_STEP, output);
          expect(dist(a, b)).toBeLessThanOrEqual(allowed);
        }
      }
    }
  });

  /**
   * scale = 1 is the crossover: the clamp range [0, 1 - w] collapses to zero
   * width there. It is the direct analogue of the old crossover at
   * w === output.w, and it is where the 229px teleport lived. The sweeps above
   * would catch a jump here too; these probes pin the known boundaries at a
   * resolution far below the grid, where the original bug lived.
   */
  it("is continuous either side of every boundary", () => {
    for (const output of OUTPUTS) {
      for (const s of [1, 1.176, 1.6, 2.0]) {
        for (const b of boundaries(s)) {
          for (const eps of [-EPS, 0, EPS]) {
            const a = at(s, b + eps, b + eps, output);
            const c = at(s + EPS, b + eps, b + eps, output);
            expect(dist(a, c)).toBeLessThanOrEqual(K * EPS + 1e-9);
          }
        }
        expect(dist(at(s - EPS, 0.5, 0.5, output), at(s + EPS, 0.5, 0.5, output)))
          .toBeLessThanOrEqual(K * 2 * EPS + 1e-9);
      }
    }
  });
});

describe("sourceToFrame (invariants 5 and 6)", () => {
  const frame = frameFor(SOURCE);

  it("maps the centre of the region to the centre of the frame", () => {
    const rect = at(1.6, 0.3, 0.7);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };

    expect(sourceToFrame(p, rect, frame)).toEqual({
      x: frame.x + frame.w / 2,
      y: frame.y + frame.h / 2,
    });
  });

  it("maps the whole source across the whole frame at rest", () => {
    const rect = at(1);
    expect(sourceToFrame({ x: 0, y: 0 }, rect, frame)).toEqual({ x: frame.x, y: frame.y });
    expect(sourceToFrame({ x: 1, y: 1 }, rect, frame)).toEqual({
      x: frame.x + frame.w,
      y: frame.y + frame.h,
    });
  });

  /** Invariant 6: an overlay outside the sampled region is not rendered. */
  it("rejects a point outside the sampled region", () => {
    const rect = at(2, 0.5, 0.5); // samples the middle half
    expect(sourceToFrame({ x: 0.05, y: 0.5 }, rect, frame)).toBeNull();
    expect(sourceToFrame({ x: 0.5, y: 0.95 }, rect, frame)).toBeNull();
  });

  it("keeps top-left orientation (invariant 10)", () => {
    // A point in the source's TOP half must land in the frame's TOP half.
    const rect = at(1);
    const mapped = sourceToFrame({ x: 0.5, y: 0.25 }, rect, frame);
    expect(mapped?.y).toBeLessThan(frame.y + frame.h / 2);
  });
});
