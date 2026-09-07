import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { cursorAt } from "../cursor/path";
import { clampToSource, followPath } from "./camera";
import type { PlanContext } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
  durationMs: 60_000,
};

/** A step input: the hardest case for anything that carries velocity. */
function step(from: number, to: number): TelemetryEvent[] {
  return [
    { k: "move", t: 0, x: from, y: 0 },
    { k: "move", t: 100, x: to, y: 0 },
    { k: "move", t: 3000, x: to, y: 0 },
  ];
}

describe("followPath", () => {
  it("never overshoots a step input", () => {
    const path = followPath(step(0, 1000), { halfLifeMs: 300, sampleHz: 120 });

    for (let t = 0; t <= 2000; t += 10) {
      expect(cursorAt(path, t)?.x ?? 0).toBeLessThanOrEqual(1000);
    }
  });

  /**
   * The property that keeps preview and export in agreement.
   *
   * Note what it is NOT: two paths BUILT at different grid rates do not agree
   * exactly, because the grid also quantises when a telemetry target changes —
   * exponential decay composes exactly only while the target is constant. What
   * parity needs is that one precomputed path read at 60fps and at 30fps
   * returns the same positions, which is what a fixed grid plus cursorAt gives.
   */
  it("returns the same positions however often it is read", () => {
    const path = followPath(step(0, 1000), { halfLifeMs: 300, sampleHz: 120 });

    // Frame times computed from the index, not accumulated, exactly as a
    // player derives them.
    const at60 = Array.from({ length: 121 }, (_, i) => cursorAt(path, (i * 1000) / 60)?.x ?? 0);

    for (let i = 0; i <= 60; i++) {
      // Every 30fps sample must be the 60fps sample it coincides with: one
      // precomputed array, read twice.
      expect(cursorAt(path, (i * 1000) / 30)?.x ?? 0).toBe(at60[i * 2]);
    }
  });

  it("converges to the same curve whatever grid it was built on", () => {
    // Once the target has been steady for several half-lives, the grid rate
    // stops mattering — the decay itself composes exactly.
    const events = step(0, 1000);
    const coarse = followPath(events, { halfLifeMs: 300, sampleHz: 60 });
    const fine = followPath(events, { halfLifeMs: 300, sampleHz: 240 });

    for (const t of [1500, 2000, 2500]) {
      // Within a couple of pixels of a 1000px step, five half-lives on.
      const drift = Math.abs((cursorAt(coarse, t)?.x ?? 0) - (cursorAt(fine, t)?.x ?? 0));
      expect(drift).toBeLessThan(2);
    }
  });

  it("lags far behind the cursor, which is the point", () => {
    const path = followPath(step(0, 1000), { halfLifeMs: 300, sampleHz: 120 });
    // One half-life after the step, roughly halfway there — not on top of it.
    expect(cursorAt(path, 400)?.x ?? 0).toBeLessThan(700);
    expect(cursorAt(path, 3000)?.x ?? 0).toBeGreaterThan(950);
  });
});

describe("clampToSource", () => {
  /**
   * Every scale above 1 crops now, at every aspect. Before 2026-09-07 nothing
   * cropped below 1/paddingFactor — which at the native aspect was the ceiling
   * itself — so the follow camera had nowhere to go and was inert. These tests
   * used to encode that; they encode the new geometry instead.
   */
  it("clamps so the viewport never leaves the source", () => {
    const { cx } = clampToSource({ cx: 0, cy: 0.5 }, 1.6, ctx);
    expect(cx).toBeCloseTo(1 / 1.6 / 2, 9);
  });

  it("leaves a centred viewport alone", () => {
    expect(clampToSource({ cx: 0.5, cy: 0.5 }, 1.6, ctx)).toEqual({ cx: 0.5, cy: 0.5 });
  });

  /** The camera now has somewhere to go at EVERY aspect, which it did not before. */
  it("pans at the native aspect", () => {
    const a = clampToSource({ cx: 0.45, cy: 0.5 }, 1.6, ctx).cx;
    const b = clampToSource({ cx: 0.5, cy: 0.5 }, 1.6, ctx).cx;
    expect(b).toBeGreaterThan(a);
  });

  it("pans at a cropping aspect too", () => {
    const square: PlanContext = { ...ctx, output: { w: 1080, h: 1080 } };
    const a = clampToSource({ cx: 0.45, cy: 0.5 }, 1.6, square).cx;
    const b = clampToSource({ cx: 0.5, cy: 0.5 }, 1.6, square).cx;
    expect(b).toBeGreaterThan(a);
  });

  it("decelerates into an edge rather than sticking at it", () => {
    // Successive approach positions map to successive clamped positions right
    // up to the bound; a clamp that snapped would return the bound for both.
    const a = clampToSource({ cx: 0.35, cy: 0.5 }, 1.6, ctx).cx;
    const b = clampToSource({ cx: 0.4, cy: 0.5 }, 1.6, ctx).cx;
    expect(b).toBeGreaterThan(a);
  });

  it("has nowhere to pan at rest", () => {
    expect(clampToSource({ cx: 0.1, cy: 0.9 }, 1, ctx)).toEqual({ cx: 0.5, cy: 0.5 });
  });

  it("keeps a centre inside the source", () => {
    const { cx, cy } = clampToSource({ cx: -0.4, cy: 1.9 }, 1.6, ctx);
    expect(cx).toBeGreaterThanOrEqual(1 / 1.6 / 2 - 1e-9);
    expect(cy).toBeLessThanOrEqual(1 - 1 / 1.6 / 2 + 1e-9);
  });
});
