import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { planZoom } from "./planner";
import { segmentsToKeyframes } from "./keyframes";
import { zoomAt } from "./interpolate";
import { screenQuadFor } from "./viewport";
import type { TelemetryEvent } from "../bundle/types";
import type { PlanContext } from "./types";

const ctx: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 }, paddingFactor: 0.85, durationMs: 60000 };
const click = (t: number, x = 500): TelemetryEvent => ({ k: "down", t, x, y: 540, b: 1 });
const plan = (events: TelemetryEvent[], context = ctx) => {
  const segments = planZoom(events, cfg, context);
  return { segments, kfs: segmentsToKeyframes(segments, cfg, context) };
};

describe("click-aligned camera motion", () => {
  it("does not anticipate a click beyond the configured lead-in", () => {
    const { kfs } = plan([click(10000)]);
    expect(zoomAt(kfs, 10000 - cfg.leadInMs).scale).toBe(1);
    expect(zoomAt(kfs, 10000).scale).toBeGreaterThan(1);
    expect(kfs[0]?.tSourceMs).toBe(10000 - cfg.leadInMs + cfg.transitionMs);
  });

  it("does not pull out and re-enter for related clicks", () => {
    // Previously these sat on opposite sides of the segment recovery guard,
    // while their rendered transitions overlapped the recovery gap.
    const { segments, kfs } = plan([click(10000), click(12500, 1500), click(15000, 400)]);
    expect(segments).toHaveLength(1);
    expect(kfs.filter(k => k.scale === 1)).toHaveLength(1);
    for (let t = 11000; t < 15000; t += 1000 / 60) expect(zoomAt(kfs, t).scale).toBeGreaterThan(1.5);
  });

  it("preserves distinct targets in rapid clicks instead of averaging the whole screen", () => {
    const { segments } = plan([click(10000, 200), click(11200, 1700)]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.waypoints.map(w => w.cx)).toEqual([200 / 1920, 1700 / 1920]);
  });

  it("leaves real idle time between separate zooms", () => {
    const { segments, kfs } = plan([click(10000), click(18000, 1500)]);
    expect(segments).toHaveLength(2);
    const out = kfs.find(k => k.scale === 1);
    const next = kfs.find(k => k.scale > 1 && k.tSourceMs > (out?.tSourceMs ?? Infinity));
    expect((next?.tSourceMs ?? 0) - (next?.transitionMs ?? 0) - (out?.tSourceMs ?? 0)).toBeGreaterThanOrEqual(cfg.minRecoveryMs);
  });

  it("does not zoom through a long idle gap just because clicks share a location", () => {
    expect(plan([click(5000), click(25000)]).segments).toHaveLength(2);
  });

  it("holds until the final event, including activity near the end of a take", () => {
    const context = { ...ctx, durationMs: 12500 };
    const { kfs } = plan([click(5000), click(7000), click(9000), click(11000), click(12000)], context);
    expect(zoomAt(kfs, 11999).scale).toBeGreaterThan(1.5);
    expect(kfs.every(k => k.tSourceMs <= context.durationMs)).toBe(true);
  });

  it("keeps screen motion continuous through every keyframe", () => {
    const { kfs } = plan([click(10000, 200), click(12500, 1700), click(16000, 900)]);
    for (const k of kfs) {
      const before = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, zoomAt(kfs, k.tSourceMs - 0.001));
      const after = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, zoomAt(kfs, k.tSourceMs + 0.001));
      expect(Math.abs(before.x - after.x)).toBeLessThan(0.1);
      expect(Math.abs(before.w - after.w)).toBeLessThan(0.1);
    }
  });

  it("bounds acceleration at the start and end of pans", () => {
    const { kfs } = plan([click(10000, 300), click(13500, 1600)]);
    const pan = kfs.find(k => k.easing === "cameraPan");
    expect(pan).toBeDefined();
    const frame = 1000 / 60;
    for (const t of [(pan?.tSourceMs ?? 0) - (pan?.transitionMs ?? 0), pan?.tSourceMs ?? 0]) {
      const x = (time: number) => screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, zoomAt(kfs, time)).x;
      expect(Math.abs(x(t + frame) - 2 * x(t) + x(t - frame))).toBeLessThan(5);
    }
  });

  it("never lets generated transitions escape their segment boundaries", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 59000 }), { minLength: 1, maxLength: 25 }), times => {
      const events = [...new Set(times)].sort((a, b) => a - b).map((t, i) => click(t, i % 2 ? 1500 : 400));
      const { segments, kfs } = plan(events);
      for (let i = 1; i < segments.length; i++) {
        expect((segments[i]?.startMs ?? 0) - (segments[i - 1]?.endMs ?? 0)).toBeGreaterThanOrEqual(cfg.minRecoveryMs);
      }
      for (const s of segments) {
        const ins = kfs.filter(k => s.waypoints.some(w => k.id === `${w.id}i`));
        for (const k of ins) expect(k.tSourceMs - k.transitionMs).toBeGreaterThanOrEqual(s.startMs);
        expect(s.endMs).toBeLessThanOrEqual(ctx.durationMs);
      }
      for (let i = 1; i < kfs.length; i++) expect(kfs[i]?.tSourceMs).toBeGreaterThan(kfs[i - 1]?.tSourceMs ?? 0);
    }), { numRuns: 300 });
  });
  it("budgets shots without losing the final clicks in dense activity", () => {
    const dense = { ...cfg, maxZoomsPerMinute: 2 };
    const events = Array.from({ length: 30 }, (_, i) => click(5000 + i * 1000, i % 2 ? 1600 : 300));
    const segments = planZoom(events, dense, ctx);
    const kfs = segmentsToKeyframes(segments, dense, ctx);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.waypoints.at(-1)?.tMs).toBe(34000 - cfg.leadInMs);
    expect(zoomAt(kfs, 34000).scale).toBeGreaterThan(1.5);
  });

});
