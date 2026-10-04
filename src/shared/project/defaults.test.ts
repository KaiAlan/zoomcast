import { describe, expect, it } from "vitest";
import { defaultProject } from "./defaults";

describe("defaultProject", () => {
  it("shows the cursor by default", () => {
    expect(defaultProject("b").style.cursor.visible).toBe(true);
  });

  it("defaults to a smoothed, shadowed cursor at native size", () => {
    const cursor = defaultProject("b").style.cursor;
    expect(cursor.sizePct).toBe(100);
    expect(cursor.smoothing).toBeGreaterThan(0);
    expect(cursor.smoothing).toBeLessThanOrEqual(1);
    expect(cursor.shadow).toBe(true);
  });
});

describe("motion blur", () => {
  it("defaults off", () => {
    // Off by default so the default verify:parity configuration is unmoved,
    // and per 2026-09-04-composition-and-camera-design.md:375 it may stay off
    // if export time suffers.
    expect(defaultProject("b1").style.motionBlurAmount).toBe(0);
  });
});
