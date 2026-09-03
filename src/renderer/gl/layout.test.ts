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
