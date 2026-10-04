import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH_CONFIG, zoomDepth } from "./depth";

const cfg = DEFAULT_DEPTH_CONFIG;
const none = { x: 0, y: 0 };

/** The base is a fraction of the ceiling; this is what it renders as. */
const scaleFor = (intent: "click" | "type" | "scroll", c = cfg): number =>
  1 + c.base[intent] * (c.maxZoom - 1);

describe("zoomDepth", () => {
  it("goes deepest for a click", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(scaleFor("click"), 9);
  });

  it("leaves context when reading", () => {
    const type = zoomDepth({ intent: "type", spread: none }, cfg);
    expect(type).toBeLessThan(zoomDepth({ intent: "click", spread: none }, cfg));
    expect(type).toBeGreaterThan(zoomDepth({ intent: "scroll", spread: none }, cfg));
  });

  /**
   * The dial has to move the picture. Absolute bases made this fail: zoomDepth
   * returns min(base, pullback) capped at the ceiling, so a click base of 1.55
   * pinned every setting above 1.55 to 1.55 and the only depth control the UI
   * exposed did nothing at all.
   */
  it("deepens every intent when the ceiling is raised", () => {
    const deeper = { ...cfg, maxZoom: 2.5 };

    for (const intent of ["click", "type", "scroll"] as const) {
      const before = zoomDepth({ intent, spread: none }, cfg);
      const after = zoomDepth({ intent, spread: none }, deeper);
      expect(after).toBeGreaterThan(before);
      expect(after).toBeCloseTo(scaleFor(intent, deeper), 9);
    }
  });

  it("keeps the grading between intents at any ceiling", () => {
    const deeper = { ...cfg, maxZoom: 2.5 };
    expect(zoomDepth({ intent: "click", spread: none }, deeper)).toBeGreaterThan(
      zoomDepth({ intent: "type", spread: none }, deeper),
    );
  });

  /**
   * The most common path, not an edge case: 29 of the 54 clusters on disk have
   * no spatial spread at all.
   */
  it("applies no pullback at zero spread", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(scaleFor("click"), 9);
  });

  it("pulls back so a spread-out cluster still fits", () => {
    const spreadX = 0.7;
    const wide = zoomDepth({ intent: "click", spread: { x: spreadX, y: 0.1 } }, cfg);
    expect(wide).toBeLessThan(scaleFor("click"));
    expect(wide).toBeCloseTo(cfg.contextFraction / spreadX, 9);
  });

  it("uses the larger axis of the spread", () => {
    // Spreads chosen so the pullback actually binds on the larger axis — with
    // a non-binding pair this passes whether the code takes the max or the min.
    const a = zoomDepth({ intent: "click", spread: { x: 0.7, y: 0.1 } }, cfg);
    const b = zoomDepth({ intent: "click", spread: { x: 0.1, y: 0.7 } }, cfg);

    expect(a).toBeCloseTo(b, 12);
    expect(a).toBeLessThan(scaleFor("click"));
  });

  it("never zooms out, and never passes the ceiling", () => {
    expect(zoomDepth({ intent: "click", spread: { x: 0.99, y: 0.99 } }, cfg)).toBe(1);
    expect(zoomDepth({ intent: "click", spread: none }, { ...cfg, maxZoom: 1.2 }))
      .toBeLessThanOrEqual(1.2);
  });

  it("is pure — same inputs, same answer", () => {
    const inputs = { intent: "click" as const, spread: { x: 0.2, y: 0.2 } };
    expect(zoomDepth(inputs, cfg)).toBe(zoomDepth(inputs, cfg));
  });

  /** The seam. Absent must mean "no constraint", never "size zero". */
  it("ignores an absent target size", () => {
    expect(zoomDepth({ intent: "click", spread: none, targetSize: undefined }, cfg))
      .toBeCloseTo(scaleFor("click"), 9);
  });

  /** DEFAULT_DEPTH_CONFIG is derived, so a retune of config.ts reaches here. */
  it("tracks the shipped config rather than a copy of it", () => {
    // Raised from 1.6 on 2026-09-08: too shallow to be worth the move.
    expect(cfg.maxZoom).toBe(2.4);
    expect(cfg.base.click).toBeGreaterThan(cfg.base.type);
    expect(cfg.base.type).toBeGreaterThan(cfg.base.scroll);
  });
});
