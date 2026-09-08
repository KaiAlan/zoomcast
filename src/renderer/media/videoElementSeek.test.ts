import { describe, expect, it } from "vitest";
import { needsSeek } from "./VideoElementSource";

describe("needsSeek", () => {
  it("does not seek when already within tolerance", () => {
    expect(needsSeek(1000, 1005, 20)).toBe(false);
    expect(needsSeek(1000, 995, 20)).toBe(false);
  });

  it("seeks when outside tolerance in either direction", () => {
    expect(needsSeek(1000, 1100, 20)).toBe(true);
    expect(needsSeek(1000, 900, 20)).toBe(true);
  });

  it("treats the tolerance boundary as no seek", () => {
    expect(needsSeek(1000, 1020, 20)).toBe(false);
  });

  it("defaults to just over one frame at 60fps", () => {
    // 16.7ms is a frame; a 18ms drift must not trigger a seek, a 25ms one must.
    expect(needsSeek(1000, 1018)).toBe(false);
    expect(needsSeek(1000, 1025)).toBe(true);
  });
});
