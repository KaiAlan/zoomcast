import { describe, expect, it } from "vitest";
import { dragKindAt, EDGE_HIT_PX, MIN_RESIZABLE_PX, msToPct, pxToFrac } from "./geometry";

describe("pxToFrac", () => {
  it("scales a pixel offset into a fraction of the track", () => {
    expect(pxToFrac(100, 1000)).toBe(0.1);
  });

  it("is signed", () => {
    expect(pxToFrac(-100, 1000)).toBe(-0.1);
  });

  it("is zero for a zero-width track rather than NaN or Infinity", () => {
    expect(pxToFrac(100, 0)).toBe(0);
  });
});

describe("msToPct", () => {
  it("maps a time onto a percentage of the track", () => {
    expect(msToPct(30_000, 60_000)).toBe(50);
  });

  it("is zero for a zero-length take rather than NaN", () => {
    expect(msToPct(0, 0)).toBe(0);
  });
});

describe("dragKindAt", () => {
  it("resizes from the left edge", () => {
    expect(dragKindAt(2, 200)).toBe("resize-start");
  });

  it("resizes from the right edge", () => {
    expect(dragKindAt(197, 200)).toBe("resize-end");
  });

  it("moves from the middle", () => {
    expect(dragKindAt(100, 200)).toBe("move");
  });

  it("treats exactly EDGE_HIT_PX in as the body", () => {
    expect(dragKindAt(EDGE_HIT_PX, 200)).toBe("move");
  });

  it("is move-only below the resizable width", () => {
    // A 1.5s shot on a 90s take is ~12px wide. If both ends were edges there
    // would be nothing left to grab.
    expect(dragKindAt(1, MIN_RESIZABLE_PX - 1)).toBe("move");
    expect(dragKindAt(MIN_RESIZABLE_PX - 2, MIN_RESIZABLE_PX - 1)).toBe("move");
  });
});
