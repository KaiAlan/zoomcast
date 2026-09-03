import { describe, expect, it } from "vitest";
import { toStreamLocalMs } from "./streamTime";

describe("toStreamLocalMs", () => {
  it("subtracts a positive start offset", () => {
    // mic started 142ms after the screen, so source 5000 is 4858 into mic.webm
    expect(toStreamLocalMs(5000, 142)).toBe(4858);
  });

  it("is identity for the reference screen track", () => {
    expect(toStreamLocalMs(5000, 0)).toBe(5000);
  });

  it("adds the sync nudge", () => {
    expect(toStreamLocalMs(5000, 142, 50)).toBe(4908);
  });

  it("handles a negative nudge", () => {
    expect(toStreamLocalMs(5000, 142, -50)).toBe(4808);
  });
});
