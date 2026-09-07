import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH_CONFIG, zoomDepth } from "./depth";

const cfg = DEFAULT_DEPTH_CONFIG;
const none = { x: 0, y: 0 };

describe("zoomDepth", () => {
  it("goes deepest for a click", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(cfg.base.click, 9);
  });

  it("leaves context when reading", () => {
    const type = zoomDepth({ intent: "type", spread: none }, cfg);
    expect(type).toBeLessThan(zoomDepth({ intent: "click", spread: none }, cfg));
    expect(type).toBeGreaterThan(zoomDepth({ intent: "scroll", spread: none }, cfg));
  });

  /**
   * The most common path, not an edge case: 29 of the 54 clusters on disk have
   * no spatial spread at all.
   */
  it("applies no pullback at zero spread", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(cfg.base.click, 9);
  });

  it("pulls back so a spread-out cluster still fits", () => {
    const spreadX = 0.7;
    const wide = zoomDepth({ intent: "click", spread: { x: spreadX, y: 0.1 } }, cfg);
    expect(wide).toBeLessThan(cfg.base.click);
    expect(wide).toBeCloseTo(cfg.contextFraction / spreadX, 9);
  });

  it("uses the larger axis of the spread", () => {
    const a = zoomDepth({ intent: "click", spread: { x: 0.5, y: 0.1 } }, cfg);
    const b = zoomDepth({ intent: "click", spread: { x: 0.1, y: 0.5 } }, cfg);
    expect(a).toBeCloseTo(b, 12);
  });

  it("never zooms out, and never passes the ceiling", () => {
    expect(zoomDepth({ intent: "click", spread: { x: 0.99, y: 0.99 } }, cfg)).toBe(1);
    expect(zoomDepth({ intent: "click", spread: none }, { ...cfg, maxZoom: 1.2 })).toBe(1.2);
  });

  it("is pure — same inputs, same answer", () => {
    const inputs = { intent: "click" as const, spread: { x: 0.2, y: 0.2 } };
    expect(zoomDepth(inputs, cfg)).toBe(zoomDepth(inputs, cfg));
  });

  /** The seam. Absent must mean "no constraint", never "size zero". */
  it("ignores an absent target size", () => {
    expect(zoomDepth({ intent: "click", spread: none, targetSize: undefined }, cfg))
      .toBeCloseTo(cfg.base.click, 9);
  });
});
