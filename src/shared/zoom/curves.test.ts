import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { CURVES } from "./curves";

describe("CURVES", () => {
  /**
   * A <select> whose value is not among its options renders the first option
   * and turns every change into a one-way trip: the default curve could be
   * left but never returned to.
   */
  it("offers the default curve, so the picker can show it and return to it", () => {
    expect(CURVES.map((c) => c.value)).toContain(DEFAULT_ZOOM_CONFIG.easing);
  });

  it("never offers the mechanisms", () => {
    const offered = CURVES.map((c) => c.value);
    expect(offered).not.toContain("linear");
    expect(offered).not.toContain("cameraPan");
  });
});
