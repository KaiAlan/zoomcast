import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { followPath, safeAreaFollower } from "./camera";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { zoomAt } from "./interpolate";
import { segmentsToKeyframes } from "./keyframes";
import { planZoom } from "./planner";
import type { PlanContext } from "./types";
import { screenQuadFor } from "./viewport";

const ctx: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 },
  paddingFactor: 0.85, durationMs: 15000 };
const event = (t: number, x: number, y = 540): TelemetryEvent => ({ k: "move", t, x, y });
const focus = { cx: 0.5, cy: 0.5 };

describe("safe-area camera", () => {
  it("holds the reading area through cursor motion inside the rendered safe zone", () => {
    const path = followPath([event(0, 960), event(500, 1100), event(1500, 850), event(4000, 960)]);
    const track = safeAreaFollower(focus, 2.2, ctx);
    for (let t = 0; t <= 4000; t += 1000 / 120) expect(track(path, t, 1000 / 120)).toEqual(focus);
  });

  it("moves on a cursor escape without waiting for another click or changing scale", () => {
    const events: TelemetryEvent[] = [event(0, 960), { k: "down", t: 1000, x: 960, y: 540, b: 1 },
      event(3000, 1800), event(7000, 1800)];
    const segments = planZoom(events, cfg, ctx).map(s => ({ ...s, endMs: 10000 }));
    expect(segments[0]?.position).toBe("follow");
    const kfs = segmentsToKeyframes(segments, cfg, ctx, followPath(events));
    const initial = zoomAt(kfs, 2500);
    expect(initial.cx).toBe(0.5);
    const later = zoomAt(kfs, 6000);
    expect(later.cx).toBeGreaterThan(initial.cx);
    expect(later.scale).toBe(initial.scale);
    const quad = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, later);
    expect(quad.x + 1800 / 1920 * quad.w).toBeLessThanOrEqual(ctx.output.w + 1e-6);
  });

  it("follows a teleport smoothly, settles without drifting, and stays within source bounds at each aspect", () => {
    const path = followPath([event(0, 960), event(1000, 1700), event(8000, 1700)]);
    for (const output of [ctx.output, { w: 1080, h: 1080 }, { w: 1080, h: 1920 }]) {
      const context = { ...ctx, output };
      const track = safeAreaFollower(focus, 2.4, context);
      let previous = screenQuadFor(ctx.source, output, ctx.paddingFactor, { scale: 2.4, ...focus });
      let held = focus;
      const speeds: number[] = [];
      for (let i = 0; i <= 960; i++) {
        const centre = track(path, i * 1000 / 120, 1000 / 120);
        const quad = screenQuadFor(ctx.source, output, ctx.paddingFactor, { scale: 2.4, ...centre });
        speeds.push(Math.abs(quad.x - previous.x));
        expect(speeds.at(-1)).toBeLessThanOrEqual(output.w / 120 + 1e-6);
        if (quad.w >= output.w) {
          expect(quad.x).toBeLessThanOrEqual(1e-6);
          expect(quad.x + quad.w).toBeGreaterThanOrEqual(output.w - 1e-6);
        }
        if (i === 720) held = centre;
        if (i === 960) expect(centre.cx).toBeCloseTo(held.cx, 6);
        previous = quad;
      }
      expect(Math.max(...speeds)).toBeGreaterThan(0);
      expect(speeds[121]).toBeLessThan(Math.max(...speeds) * 0.2);
    }
  });

  it("does not keep moving in the old direction after a reversal has settled", () => {
    const path = followPath([event(0, 960), event(1000, 1800), event(2500, 120), event(6000, 120)]);
    const track = safeAreaFollower(focus, 2.2, ctx);
    let before = focus;
    let after = focus;
    for (let i = 0; i <= 720; i++) {
      const centre = track(path, i * 1000 / 120, 1000 / 120);
      if (i === 300) before = centre;
      if (i === 720) after = centre;
    }
    expect(before.cx).toBeGreaterThan(0.5);
    expect(after.cx).toBeLessThan(0.5);
  });

  it("keeps the click anchor on entrance even if the cursor has since moved", () => {
    const events: TelemetryEvent[] = [{ k: "down", t: 1000, x: 600, y: 540, b: 1 },
      event(1400, 1700), event(10000, 1700)];
    const kfs = segmentsToKeyframes(planZoom(events, cfg, ctx), cfg, ctx, followPath(events));
    expect(kfs[0]?.cx).toBeCloseTo(600 / 1920, 6);
    expect(zoomAt(kfs, 750).scale).toBe(1);
    expect(zoomAt(kfs, 1000).scale).toBeGreaterThan(1.3);
  });

  it("tracks an escape during entrance and carries its velocity into the hold", () => {
    const events: TelemetryEvent[] = [event(0, 600),
      { k: "down", t: 1000, x: 600, y: 540, b: 1 },
      event(1900, 600), event(2100, 1700), event(10000, 1700)];
    const segments = planZoom(events, cfg, ctx);
    const kfs = segmentsToKeyframes(segments, cfg, ctx, followPath(events));
    const start = segments[0]!.startMs;
    const arrival = start + cfg.transitionMs;
    // The first part still frames the click. Following must not wait until
    // arrival, then reset its spring velocity and start a second camera move.
    expect(zoomAt(kfs, start + 300).cx).toBeCloseTo(kfs[0]!.cx, 6);
    expect(zoomAt(kfs, arrival).cx).toBeGreaterThan(kfs[0]!.cx + 0.05);
    const step = 1000 / 60;
    const before = zoomAt(kfs, arrival - step);
    const boundary = zoomAt(kfs, arrival);
    const after = zoomAt(kfs, arrival + step);
    const incoming = boundary.cx - before.cx;
    const outgoing = after.cx - boundary.cx;
    expect(incoming).toBeGreaterThan(0.001);
    expect(outgoing / incoming).toBeGreaterThan(0.65);
    expect(outgoing / incoming).toBeLessThan(1.4);
    expect(after.scale).toBe(boundary.scale);
    const q = (t: number) => screenQuadFor(ctx.source, ctx.output, 0.85, zoomAt(kfs, t));
    expect(Math.abs(q(arrival - 0.001).x - q(arrival + 0.001).x)).toBeLessThan(0.01);
  });

  it("keeps one continuous follow path through repeated clicks and typing", () => {
    const events: TelemetryEvent[] = [event(0, 600),
      { k: "down", t: 1000, x: 600, y: 540, b: 1 },
      { k: "down", t: 3000, x: 1500, y: 540, b: 1 },
      { k: "down", t: 5000, x: 300, y: 540, b: 1 },
      { k: "key", t: 5500, d: "down", c: "A" },
      { k: "key", t: 5700, d: "down", c: "B" }, event(8000, 300)];
    const segments = planZoom(events, cfg, ctx);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.waypoints.length).toBeGreaterThan(1);
    const kfs = segmentsToKeyframes(segments, cfg, ctx, followPath(events));
    expect(kfs.filter(k => k.easing === "cameraPan")).toHaveLength(0);
    expect(new Set(kfs.filter(k => k.scale > 1 && k.entrance === undefined).map(k => k.scale)).size).toBe(1);
    expect(zoomAt(kfs, 4500).cx).toBeGreaterThan(zoomAt(kfs, 2500).cx);
    expect(zoomAt(kfs, 7000).cx).toBeLessThan(zoomAt(kfs, 4500).cx);
    const out = kfs.at(-1);
    expect(out?.easing).toBe("cameraExit");
  });
});
