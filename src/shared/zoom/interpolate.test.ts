import { describe, expect, it } from "vitest";
import { NO_ZOOM, zoomAt } from "./interpolate";
import type { ZoomKeyframe } from "./types";

const kf = (tSourceMs: number, scale: number): ZoomKeyframe => ({
  id: `k${tSourceMs}`,
  tSourceMs,
  scale,
  cx: 0.25,
  cy: 0.75,
  easing: "linear",
  transitionMs: 600,
  origin: "auto",
  pinned: false,
});

describe("zoomAt", () => {
  it("returns no zoom for an empty keyframe list", () => {
    expect(zoomAt([], 1000)).toEqual(NO_ZOOM);
  });

  it("returns no zoom before the first transition begins", () => {
    expect(zoomAt([kf(1000, 2)], 100)).toEqual(NO_ZOOM);
  });

  it("returns the keyframe value at its own time", () => {
    const s = zoomAt([kf(1000, 2)], 1000);
    expect(s.scale).toBeCloseTo(2, 6);
    expect(s.cx).toBeCloseTo(0.25, 6);
  });

  it("holds the last keyframe value afterwards", () => {
    expect(zoomAt([kf(1000, 2)], 99_999).scale).toBeCloseTo(2, 6);
  });

  it("interpolates through the transition", () => {
    // linear easing, midpoint of a 600ms transition from scale 1 to 2
    const s = zoomAt([kf(1000, 2)], 700);
    expect(s.scale).toBeGreaterThan(1);
    expect(s.scale).toBeLessThan(2);
    expect(s.scale).toBeCloseTo(1.5, 2);
  });

  it("eases between two keyframes", () => {
    const kfs = [kf(1000, 2), kf(3000, 1)];
    expect(zoomAt(kfs, 2000).scale).toBeCloseTo(2, 6); // holding
    expect(zoomAt(kfs, 3000).scale).toBeCloseTo(1, 6); // arrived

    const mid = zoomAt(kfs, 2700).scale;
    expect(mid).toBeLessThan(2);
    expect(mid).toBeGreaterThan(1);
  });
});

describe("overlapping transitions", () => {
  const kf = (over: Partial<ZoomKeyframe> & { id: string }): ZoomKeyframe => ({
    tSourceMs: 0, scale: 1, cx: 0.5, cy: 0.5,
    easing: "linear", transitionMs: 600, origin: "auto", pinned: false,
    ...over,
  });

  /**
   * Measured on real takes: 9 of 134 transitions had a window starting before
   * the previous keyframe's own time — a 1000ms pan across a 260ms gap, and
   * repeated 1000ms zoom-outs beginning 650ms after the final waypoint.
   */
  it("still arrives exactly at a keyframe the next one overlaps", () => {
    const kfs = [
      kf({ id: "a", tSourceMs: 1000, scale: 1.5, cx: 0.2 }),
      kf({ id: "b", tSourceMs: 1200, scale: 1.5, cx: 0.8, transitionMs: 1000 }),
    ];

    const at = zoomAt(kfs, 1000);
    expect(at.cx).toBeCloseTo(0.2, 9);
  });

  it("is continuous across an overlapped keyframe", () => {
    const kfs = [
      kf({ id: "a", tSourceMs: 1000, scale: 1.5, cx: 0.2 }),
      kf({ id: "b", tSourceMs: 1200, scale: 1.5, cx: 0.8, transitionMs: 1000 }),
    ];

    let prev = zoomAt(kfs, 900).cx;
    for (let t = 901; t <= 1300; t++) {
      const cx = zoomAt(kfs, t).cx;
      // 0.6 of travel over 200ms is 0.003/ms; nothing may exceed that by much.
      expect(Math.abs(cx - prev)).toBeLessThan(0.01);
      prev = cx;
    }
  });

  it("leaves a well-separated pair untouched", () => {
    const kfs = [
      kf({ id: "a", tSourceMs: 1000, scale: 1.5, cx: 0.2 }),
      kf({ id: "b", tSourceMs: 5000, scale: 1.5, cx: 0.8, transitionMs: 1000 }),
    ];

    expect(zoomAt(kfs, 3999).cx).toBeCloseTo(0.2, 9);
    expect(zoomAt(kfs, 4500).cx).toBeCloseTo(0.5, 9);
  });
});
