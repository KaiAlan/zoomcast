import { describe, expect, it } from "vitest";
import { activeDepthPresetIndex, DEPTH_PRESETS } from "./segmentDepthPresets";

describe("activeDepthPresetIndex", () => {
  it("matches an exact preset", () => {
    expect(activeDepthPresetIndex(0.55, DEPTH_PRESETS)).toBe(2);
  });

  it("matches within the 0.001 tolerance", () => {
    expect(activeDepthPresetIndex(0.5505, DEPTH_PRESETS)).toBe(2);
    expect(activeDepthPresetIndex(0.2495, DEPTH_PRESETS)).toBe(0);
  });

  it("is inclusive just inside 0.001 away", () => {
    // Not exactly 0.001 -- 0.55 - 0.551 is -0.0010000000000000009 in float64,
    // which would fail an inclusive check for the wrong reason. 0.5509 keeps
    // the test about the tolerance, not about float rounding at its edge.
    expect(activeDepthPresetIndex(0.5509, DEPTH_PRESETS)).toBe(2);
  });

  it("does not match just past the tolerance", () => {
    expect(activeDepthPresetIndex(0.5511, DEPTH_PRESETS)).toBe(-1);
  });

  it("returns -1 for auto-planned depths that hit none of the presets", () => {
    // click, typing, scroll defaults from the planner's depth grading.
    expect(activeDepthPresetIndex(0.917, DEPTH_PRESETS)).toBe(-1);
    expect(activeDepthPresetIndex(0.583, DEPTH_PRESETS)).toBe(-1);
    expect(activeDepthPresetIndex(0.25, DEPTH_PRESETS)).toBe(0); // 0.25 is itself a preset
  });

  it("returns -1 for depth 0, which no preset covers", () => {
    expect(activeDepthPresetIndex(0, DEPTH_PRESETS)).toBe(-1);
  });

  it("defaults to DEPTH_PRESETS when no list is given", () => {
    expect(activeDepthPresetIndex(1)).toBe(5);
  });
});
