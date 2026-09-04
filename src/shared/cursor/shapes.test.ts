import { describe, expect, it } from "vitest";
import { CURSOR_SHAPES } from "./shapes";

const ALL = [
  "arrow", "ibeam", "hand", "ns", "ew", "nwse", "nesw", "wait",
] as const;

describe("CURSOR_SHAPES", () => {
  it("covers every CursorShape", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape]).toBeDefined();
  });

  it("keeps every hotspot inside its viewBox", () => {
    for (const shape of ALL) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.y).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.x).toBeLessThanOrEqual(art.viewBox);
      expect(art.hotspot.y).toBeLessThanOrEqual(art.viewBox);
    }
  });

  it("puts the arrow hotspot at its tip", () => {
    // The arrow's tip is the origin; anything else makes clicks look offset.
    expect(CURSOR_SHAPES.arrow.hotspot).toEqual({ x: 0, y: 0 });
  });

  it("centres the hotspot of every resize cursor", () => {
    for (const shape of ["ns", "ew", "nwse", "nesw"] as const) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeCloseTo(art.viewBox / 2, 5);
      expect(art.hotspot.y).toBeCloseTo(art.viewBox / 2, 5);
    }
  });

  it("gives every shape non-empty path data", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape].path.length).toBeGreaterThan(10);
  });
});
