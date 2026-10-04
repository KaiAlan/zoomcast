import { describe, expect, it } from "vitest";
import { defaultProject } from "../project/defaults";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { deriveKeyframes } from "./derive";
import { zoomAt } from "./interpolate";
import { segmentsToKeyframes } from "./keyframes";
import type { PlanContext, ZoomSegment } from "./types";
import { screenQuadFor } from "./viewport";

const ctx: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 },
  paddingFactor: 0.85, durationMs: 78150 };
// Exact first anchor in the user's 2026-10-03T14-10-06 recording.
const shot: ZoomSegment = { id: "sk57", startMs: 1730, endMs: 19799,
  position: "fixed", origin: "auto", pinned: false,
  waypoints: [{ id: "k57", tMs: 1730, depth: 0.917, cx: 1625 / 1920, cy: 149 / 1080 }] };

describe("one continuous rendered entrance", () => {
  it("does not move the clicked content away and back at any output aspect", () => {
    for (const output of [ctx.output, { w: 1080, h: 1080 }, { w: 1080, h: 1920 }]) {
      const context = { ...ctx, output };
      for (const [cx, cy] of [[1625 / 1920, 149 / 1080], [0.2, 0.8], [0.5, 0.5]]) {
        const segment = { ...shot, waypoints: [{ ...shot.waypoints[0]!, cx: cx!, cy: cy! }] };
        const kfs = segmentsToKeyframes([segment], cfg, context);
        const point = (t: number) => {
          const q = screenQuadFor(ctx.source, output, 0.85, zoomAt(kfs, t));
          return [q.x + cx! * q.w, q.y + cy! * q.h];
        };
        const initial = point(shot.startMs);
        const final = point(shot.startMs + cfg.transitionMs);
        let previous = initial;
        for (let i = 1; i <= 90; i++) {
          const current = point(shot.startMs + i * cfg.transitionMs / 90);
          for (const axis of [0, 1]) {
            const direction = Math.sign(final[axis]! - initial[axis]!);
            expect((current[axis]! - previous[axis]!) * direction).toBeGreaterThanOrEqual(-1e-6);
            expect(current[axis]!).toBeGreaterThanOrEqual(Math.min(initial[axis]!, final[axis]!) - 1e-6);
            expect(current[axis]!).toBeLessThanOrEqual(Math.max(initial[axis]!, final[axis]!) + 1e-6);
          }
          previous = current;
        }
      }
    }
  });

  it("softens the first quarter-second and limits the first shot's screen travel", () => {
    const kfs = segmentsToKeyframes([shot], cfg, ctx);
    expect(cfg.transitionMs).toBeGreaterThanOrEqual(1400);
    const click = zoomAt(kfs, 1980);
    expect(click.scale).toBeGreaterThan(1.2);
    expect(click.scale).toBeLessThan(1.4);
    expect(zoomAt(kfs, shot.startMs + cfg.transitionMs).scale).toBeGreaterThan(2.2);
    let previous = screenQuadFor(ctx.source, ctx.output, 0.85, zoomAt(kfs, shot.startMs));
    for (let i = 1; i <= 90; i++) {
      const q = screenQuadFor(ctx.source, ctx.output, 0.85, zoomAt(kfs, shot.startMs + i * 1000 / 60));
      expect(Math.abs(q.x - previous.x)).toBeLessThan(55);
      expect(Math.abs(q.y - previous.y)).toBeLessThan(55);
      previous = q;
    }
  });

  it("keeps motion continuous at the entrance-to-follow boundary", () => {
    const kfs = segmentsToKeyframes([shot], cfg, ctx);
    const arrival = shot.startMs + cfg.transitionMs;
    const q = (t: number) => screenQuadFor(ctx.source, ctx.output, 0.85, zoomAt(kfs, t));
    expect(Math.abs(q(arrival - 0.001).x - q(arrival + 0.001).x)).toBeLessThan(0.01);
    expect(Math.abs(q(arrival - 1000 / 60).x - q(arrival).x)).toBeLessThan(1);
  });

  it("reprojects pinned and stored endpoints after an aspect change", () => {
    const p = defaultProject("test");
    p.zoom.keyframes = segmentsToKeyframes([shot], cfg, ctx).map(k => ({ ...k, pinned: true }));
    const original = p.zoom.keyframes[0]!.quad;
    p.output.aspect = "1:1";
    const rebuilt = deriveKeyframes(cfg, p, { telemetry: [], cameraPath: null,
      source: ctx.source, durationMs: ctx.durationMs });
    expect(rebuilt.keyframes[0]!.quad!.w).toBeLessThan(original!.w);
    expect(rebuilt.keyframes[0]!.restQuad!.w).toBeCloseTo(1080 * 0.85, 6);
    expect(rebuilt.keyframes[0]!.cx).toBe(p.zoom.keyframes[0]!.cx);
    expect(rebuilt.keyframes[0]!.pinned).toBe(true);
  });
});
