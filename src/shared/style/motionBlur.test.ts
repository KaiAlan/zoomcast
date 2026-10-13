import { describe, expect, it } from "vitest";
import { blurAt, blurForCamera } from "./motionBlur";

const OUT = { w: 1920, h: 1080 };
const still = { x: 0, y: 0, scale: 1 };

describe("blurAt", () => {
  it("is zero for a still camera", () => {
    expect(blurAt(still, still, 16, OUT, 1).px).toBe(0);
  });

  it("is zero below the 15px/s deadzone", () => {
    // 0.1px over 16ms is 6.25px/s. Without a deadzone an idle camera shimmers.
    expect(blurAt(still, { x: 0.1, y: 0, scale: 1 }, 16, OUT, 1).px).toBe(0);
  });

  it("counts scale change as motion, so a pure zoom blurs", () => {
    expect(blurAt(still, { x: 0, y: 0, scale: 1.2 }, 16, OUT, 1).px).toBeGreaterThan(0);
  });

  it("is quadratic, so doubling speed more than doubles blur", () => {
    const slow = blurAt(still, { x: 4, y: 0, scale: 1 }, 16, OUT, 1).px;
    const fast = blurAt(still, { x: 8, y: 0, scale: 1 }, 16, OUT, 1).px;
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it("saturates at 8px times amount", () => {
    expect(blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 1).px).toBeCloseTo(8, 5);
  });

  it("scales with amount", () => {
    const one = blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 1).px;
    const half = blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 0.5).px;
    expect(half).toBeCloseTo(one / 2, 5);
  });

  it("is zero at zero amount, whatever the motion", () => {
    expect(blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 0).px).toBe(0);
  });

  it("clamps dt to 1-80ms so a stalled frame does not spike the blur", () => {
    const stalled = blurAt(still, { x: 100, y: 0, scale: 1 }, 5_000, OUT, 1);
    const at80 = blurAt(still, { x: 100, y: 0, scale: 1 }, 80, OUT, 1);
    expect(stalled.px).toBeCloseTo(at80.px, 5);
  });

  it("takes direction from the velocity vector", () => {
    expect(blurAt(still, { x: 100, y: 0, scale: 1 }, 16, OUT, 1).angleRad).toBeCloseTo(0, 5);
    expect(blurAt(still, { x: 0, y: 100, scale: 1 }, 16, OUT, 1).angleRad).toBeCloseTo(
      Math.PI / 2,
      5,
    );
  });

  it("steps the kernel 5 / 9 / 11 by blur amount", () => {
    // blur = (speed / 2000)^2 * 8, and speed = dx / dt with dt = 16ms. So the
    // dx that lands in each band is speed * 0.016:
    //   blur 0.5 -> speed  500 -> dx  8.0   (kernel 5,  blur < 2)
    //   blur 3.0 -> speed 1225 -> dx 19.6   (kernel 9,  2 <= blur < 5)
    //   blur 7.0 -> speed 1871 -> dx 29.9   (kernel 11, blur >= 5)
    const at = (dx: number) => blurAt(still, { x: dx, y: 0, scale: 1 }, 16, OUT, 1);

    expect(at(8.0).px).toBeLessThan(2);
    expect(at(8.0).kernel).toBe(5);

    expect(at(19.6).px).toBeGreaterThanOrEqual(2);
    expect(at(19.6).px).toBeLessThan(5);
    expect(at(19.6).kernel).toBe(9);

    expect(at(29.9).px).toBeGreaterThanOrEqual(5);
    expect(at(29.9).kernel).toBe(11);
  });

  it("is deterministic for the same inputs, so preview and export agree", () => {
    const a = blurAt(still, { x: 37, y: 12, scale: 1.05 }, 33.3, OUT, 0.7);
    const b = blurAt(still, { x: 37, y: 12, scale: 1.05 }, 33.3, OUT, 0.7);
    expect(a).toEqual(b);
  });
});

describe("blurForCamera", () => {
  it("uses projected screen travel even when the focus coordinates do not move", () => {
    const from = { scale: 2, cx: 0.5, cy: 0.5, quad: { x: -100, y: -100, w: 3000, h: 2000 } };
    const to = { ...from, quad: { ...from.quad, x: -120 } };
    const blur = blurForCamera(from, to, { w: 1920, h: 1080 }, 1);
    expect(blur?.px).toBeGreaterThan(0);
    expect(Math.abs(blur?.angleRad ?? 0)).toBeCloseTo(Math.PI, 6);
  });
  const OUT2 = { w: 1920, h: 1080 };
  const a = { scale: 1, cx: 0.5, cy: 0.5 };

  it("is undefined when the amount is zero, so the default path is untouched", () => {
    expect(blurForCamera(a, { scale: 1, cx: 0.9, cy: 0.5 }, OUT2, 0)).toBeUndefined();
  });

  it("is undefined for a still camera", () => {
    expect(blurForCamera(a, a, OUT2, 1)).toBeUndefined();
  });

  it("produces blur for a fast pan", () => {
    const blur = blurForCamera(a, { scale: 1, cx: 0.9, cy: 0.5 }, OUT2, 1);
    expect(blur?.px).toBeGreaterThan(0);
  });

  it("does not depend on real frame timing, so preview and export agree", () => {
    // Same source time, same result, regardless of how fast either side draws.
    const next = { scale: 1.2, cx: 0.7, cy: 0.4 };
    expect(blurForCamera(a, next, OUT2, 1)).toEqual(blurForCamera(a, next, OUT2, 1));
  });
});
