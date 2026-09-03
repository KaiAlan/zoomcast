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
