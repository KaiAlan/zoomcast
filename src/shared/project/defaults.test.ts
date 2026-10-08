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
  it("defaults to gentle motion blur for new recordings", () => {
    expect(defaultProject("b1").style.motionBlurAmount).toBe(0.35);
    expect(defaultProject("b1").style.cursor.motionBlur).toBe(0.35);
  });
});
