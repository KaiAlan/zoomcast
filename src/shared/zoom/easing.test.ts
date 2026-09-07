import { describe, expect, it } from "vitest";
import { EASINGS, cubicBezier } from "./easing";

describe("cubicBezier", () => {
  const ease = cubicBezier(0.33, 0, 0.1, 1);

  it("pins the endpoints", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("clamps out-of-range input", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("is monotonically increasing", () => {
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = ease(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it("front-loads the motion (ease-out)", () => {
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });

  it("matches a linear control polygon for the identity curve", () => {
    const linear = cubicBezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
    expect(linear(0.25)).toBeCloseTo(0.25, 4);
    expect(linear(0.5)).toBeCloseTo(0.5, 4);
    expect(linear(0.75)).toBeCloseTo(0.75, 4);
  });
});

describe("zoomGlide", () => {
  const ease = EASINGS.zoomGlide;

  it("pins the endpoints and stays monotonic", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);

    let prev = -1;
    for (let x = 0; x <= 1; x += 0.02) {
      const y = ease(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  /**
   * The property, not the samples. zoomEase puts 61% of the motion in the
   * first third and then drifts; a curve worth switching to must not.
   */
  it("does not front-load the motion", () => {
    expect(ease(1 / 3)).toBeLessThan(0.55);
    expect(EASINGS.zoomEase(1 / 3)).toBeGreaterThan(0.55);
  });

  it("keeps a real move left for the last third", () => {
    // zoomEase leaves 6% here, which is the drifting tail.
    expect(1 - ease(2 / 3)).toBeGreaterThan(0.15);
  });

  it("peaks in the middle rather than near the start", () => {
    const speedAt = (x: number): number => (ease(x + 0.01) - ease(x - 0.01)) / 0.02;
    expect(speedAt(0.5)).toBeGreaterThan(speedAt(0.25));
    expect(speedAt(0.5)).toBeGreaterThan(speedAt(0.75));
  });
});

describe("EASINGS", () => {
  it("exposes linear as an identity", () => {
    expect(EASINGS.linear(0.42)).toBeCloseTo(0.42, 6);
  });

  it("exposes zoomEase", () => {
    expect(EASINGS.zoomEase(1)).toBe(1);
  });
});

describe("screenStudio", () => {
  const f = EASINGS.screenStudio;

  it("puts nearly all the motion in the first third", () => {
    // Measured off a Recordly export: 90 / 9 / 1 across the thirds. That
    // front-loading is why a 1500ms window still reads as a quick move.
    const a = f(1 / 3);
    const b = f(2 / 3);
    expect(a).toBeGreaterThan(0.85);
    expect(b - a).toBeLessThan(0.14);
    expect(1 - b).toBeLessThan(0.04);
  });

  it("arrives at 95% in well under half the window", () => {
    let t = 0;
    while (t < 1 && f(t) < 0.95) t += 0.001;
    expect(t).toBeLessThan(0.45);
  });

  it("is monotonic and spans the unit interval", () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = f(Math.min(1, t));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
  });
});
