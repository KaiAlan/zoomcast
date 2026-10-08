import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { parseTelemetry } from "../bundle/telemetry";
import { defaultProject } from "../project/defaults";
import { deriveKeyframes, replanFrom } from "./derive";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { zoomAt } from "./interpolate";
import { adaptiveCamera } from "./adaptive";
import { projectKeyframes } from "./viewport";
import { buildCursorPath, cursorAt } from "../cursor/path";
import type { PlanContext, ZoomSegment } from "./types";

const ctx: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 }, paddingFactor: 0.85, durationMs: 10000 };
const click = (t: number, x = 900, y = 500): TelemetryEvent => ({ t, k: "down", x, y, b: 1 });
const derive = (events: TelemetryEvent[], durationMs = ctx.durationMs) => replanFrom(cfg, defaultProject("pacing"),
  { source: ctx.source, durationMs, telemetry: events, cameraPath: null });
const shot: ZoomSegment = { id: "shot", startMs: 0, endMs: 10000, position: "follow", origin: "auto", pinned: false,
  waypoints: [{ id: "anchor", tMs: 100, cx: 900 / 1920, cy: 500 / 1080, depth: cfg.depthClick }] };

function movement(events: TelemetryEvent[], from: number, until: number, hold = false) {
  const parts = hold ? { segments: [shot], keyframes: projectKeyframes(adaptiveCamera(events, cfg, ctx)(shot), ctx) } : derive(events, until);
  let previous = zoomAt(parts.keyframes, from), peakPan = 0, peakDepth = 0, peakAcceleration = 0;
  const preceding = zoomAt(parts.keyframes, from - 1000 / 60);
  let lastVelocity = previous.quad && preceding.quad ? { x: previous.quad.x - preceding.quad.x, y: previous.quad.y - preceding.quad.y } : { x: 0, y: 0 };
  for (let t = from + 1000 / 60; t < until; t += 1000 / 60) {
    const next = zoomAt(parts.keyframes, t);
    peakDepth = Math.max(peakDepth, Math.abs(next.scale - previous.scale));
    if (previous.quad && next.quad) {
      const velocity = { x: next.quad.x - previous.quad.x, y: next.quad.y - previous.quad.y };
      peakPan = Math.max(peakPan, Math.hypot(velocity.x, velocity.y));
      peakAcceleration = Math.max(peakAcceleration, Math.hypot(velocity.x - lastVelocity.x, velocity.y - lastVelocity.y));
      lastVelocity = velocity;
    }
    previous = next;
  }
  return { ...parts, peakPan, peakDepth, peakAcceleration };
}

describe("click-triggered, steady automatic shots", () => {
  it("does not start shots from hover, scrolling or keyboard input without a click", () => {
    const events: TelemetryEvent[] = [{ t: 0, k: "move", x: 900, y: 500 }];
    for (let t = 500; t < 8000; t += 100) events.push({ t, k: "wheel", x: 900, y: 500, dy: -1 },
      { t, k: "key", d: "down", c: "KeyA" },
      { t, k: "context", trigger: "key", target: { role: "Edit", rect: { x: 700, y: 350, w: 500, h: 200 } } });
    expect(derive(events).segments).toEqual([]);
    expect(derive(events).keyframes).toEqual([]);
  });
  it("waits for the actual click even after preceding scroll/hover in the same area", () => {
    const events: TelemetryEvent[] = [{ t: 0, k: "move", x: 900, y: 500 }, { t: 800, k: "wheel", x: 900, y: 500, dy: -1 }, click(1000)];
    const parts = derive(events);
    expect(parts.segments[0]?.startMs).toBe(1000);
    for (const t of [800, 999, 1000]) expect(zoomAt(parts.keyframes, t).scale).toBe(1);
    expect(zoomAt(parts.keyframes, 1800).scale).toBeGreaterThan(1);
  });
  it("keeps depth constant while hover movement crosses the screen", () => {
    const events: TelemetryEvent[] = [click(100)];
    for (let t = 2400; t < 7000; t += 50) events.push({ t, k: "move", x: t % 400 < 200 ? 30 : 1880, y: t % 600 < 300 ? 30 : 1050 });
    const frames = projectKeyframes(adaptiveCamera(events, cfg, ctx)(shot), ctx);
    const scale = zoomAt(frames, 2200).scale;
    for (let t = 2400; t < 7500; t += 1000 / 60) expect(zoomAt(frames, t).scale).toBeCloseTo(scale, 8);
  });
  it("does not change depth when scrolling or typing after the click", () => {
    const events: TelemetryEvent[] = [click(100)];
    for (let t = 2000; t <= 5000; t += 100) events.push({ t, k: "wheel", x: 900, y: 500, dy: -1 }, { t, k: "key", d: "down", c: "KeyA" });
    const frames = projectKeyframes(adaptiveCamera(events, cfg, ctx)(shot), ctx);
    for (const t of [2200, 3100, 4500]) expect(zoomAt(frames, t).scale).toBeCloseTo(zoomAt(frames, 1900).scale, 8);
  });
  it("pays for the full entrance and exit instead of snapping depth between frames", () => {
    const parts = derive([click(1000)]);
    const segment = parts.segments[0]; expect(segment).toBeDefined();
    const start = segment?.startMs ?? 0;
    const settle = zoomAt(parts.keyframes, start + cfg.transitionMs).scale;
    expect(zoomAt(parts.keyframes, start + cfg.transitionMs / 4).scale - 1).toBeLessThan((settle - 1) * 0.35);
    expect(zoomAt(parts.keyframes, start + cfg.transitionMs * 3 / 4).scale - 1).toBeGreaterThan((settle - 1) * 0.65);
    const end = segment?.endMs ?? 0;
    expect(zoomAt(parts.keyframes, end - cfg.transitionOutMs / 2).scale).toBeCloseTo(1 + (settle - 1) / 2, 5);
    expect(zoomAt(parts.keyframes, end).scale).toBe(1);
  });
  it("retains a gentle carried velocity while following a moving cursor", () => {
    const events: TelemetryEvent[] = [click(100, 500)];
    for (let t = 2600; t <= 3400; t += 1000 / 120) events.push({ t, k: "move", x: 500 + (t - 2600) * 1.6, y: 500 });
    events.push(click(6500, 1700));
    const result = movement(events, 2400, 5000, true);
    // Fast pans may exceed the old 0.6-view/second ceiling; their acceleration
    // stays bounded so keeping up does not bring back one-frame jumps.
    expect(result.peakPan).toBeLessThan(60);
    expect(result.peakAcceleration).toBeLessThan(3);
    expect(result.peakDepth).toBeLessThan(0.00001);
  });
  it("brakes cursor following before recovery instead of freezing a moving camera", () => {
    const events: TelemetryEvent[] = [click(100, 500)];
    for (let t = 2400; t < 4100; t += 1000 / 120) events.push({ t, k: "move", x: 500 + (t - 2400) * 0.7, y: 500 });
    const result = movement(events, 2300, 5000);
    expect(result.peakAcceleration).toBeLessThan(3);
  });
  it("rebuilds sampled rectangles when output aspect changes", () => {
    const telemetry = [click(1000)];
    const project = defaultProject("aspect"); project.zoom = { ...project.zoom, ...derive(telemetry) };
    project.output.aspect = "1:1";
    const changed = deriveKeyframes(cfg, project, { source: ctx.source, durationMs: 10000, telemetry, cameraPath: null });
    expect(changed.keyframes[0]?.quad?.w).toBeCloseTo(918, 5);
    expect(zoomAt(changed.keyframes, 3000).quad?.w).toBeLessThan(2300);
  });
});

function overflow(events: TelemetryEvent[], plan: PlanContext, from: number, until: number) {
  const frames = projectKeyframes(adaptiveCamera(events, cfg, plan)(shot), plan);
  const paths = [0, 72, 90].map(halfLifeMs => buildCursorPath(events, { halfLifeMs, sampleHz: 120, pinClicks: true }));
  let peak = 0;
  for (let t = from; t < until; t += 1000 / 60) {
    const quad = zoomAt(frames, t).quad;
    if (!quad) continue;
    // Verify the actual drawn cursor too: default and maximum smoothing can
    // trail the raw pointer even when the camera is ahead of its movement.
    for (const path of paths) {
      const cursor = cursorAt(path, t); if (!cursor) continue;
      const x = quad.x + cursor.x / plan.source.w * quad.w, y = quad.y + cursor.y / plan.source.h * quad.h;
      peak = Math.max(peak, -x, x - plan.output.w, -y, y - plan.output.h);
    }
  }
  return { frames, peak };
}

describe("fast cursor visibility", () => {
  it("retains a close composition for slow movement near the clicked control", () => {
    const events: TelemetryEvent[] = [click(100, 700)];
    for (let t = 2400; t <= 4400; t += 50) events.push({ t, k: "move", x: 700 + (t - 2400) * 0.025, y: 500 });
    const result = overflow(events, ctx, 2200, 4800);
    expect(result.peak).toBeLessThan(1);
    expect(zoomAt(result.frames, 4000).scale).toBeGreaterThan(2);
  });
  it("keeps up with a sustained sweep without accelerating abruptly or changing depth", () => {
    const events: TelemetryEvent[] = [click(100, 500)];
    for (let t = 2600; t <= 3400; t += 1000 / 120) events.push({ t, k: "move", x: 500 + (t - 2600) * 1.6, y: 500 });
    const result = overflow(events, ctx, 2500, 4100);
    expect(result.peak).toBeLessThan(1);
    expect(zoomAt(result.frames, 3900).scale).toBeCloseTo(zoomAt(result.frames, 2200).scale, 8);
  });
  it("follows travel during the entrance while preserving the slower depth transition", () => {
    const events: TelemetryEvent[] = [click(100, 500)];
    for (let t = 500; t <= 1300; t += 1000 / 120) events.push({ t, k: "move", x: 500 + (t - 500) * 1.6, y: 500 });
    const result = overflow(events, ctx, 100, 2200);
    expect(result.peak).toBeLessThan(1);
    const settled = zoomAt(result.frames, 1700).scale;
    expect(zoomAt(result.frames, 100 + cfg.transitionMs / 4).scale - 1).toBeLessThan((settled - 1) * 0.35);
    expect(zoomAt(result.frames, 100).scale).toBe(1);
  });
  for (const output of [{ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, { w: 1080, h: 1920 }]) {
    it(`keeps a very fast diagonal sweep visible with one steady composition in ${output.w}x${output.h}`, () => {
      const events: TelemetryEvent[] = [click(100, 200, 100)];
      for (let t = 2600; t <= 2800; t += 1000 / 120) events.push({ t, k: "move", x: 200 + (t - 2600) * 8, y: 100 + (t - 2600) * 4.4 });
      const result = overflow(events, { ...ctx, output }, 2300, 4200);
      expect(result.peak).toBeLessThan(1);
      const settled = zoomAt(result.frames, 2200).scale;
      for (const t of [2500, 2700, 2900, 4000]) expect(zoomAt(result.frames, t).scale).toBeCloseTo(settled, 8);
    });
  }
  it("does not lose the pointer when it reverses near the edge", () => {
    const events: TelemetryEvent[] = [click(100, 500)];
    for (let t = 2600; t <= 4100; t += 1000 / 120) {
      const x = t <= 3400 ? 500 + (t - 2600) * 1.6 : 1780 - (t - 3400) * 2;
      events.push({ t, k: "move", x, y: 500 });
    }
    expect(overflow(events, ctx, 2300, 4800).peak).toBeLessThan(1);
    expect(movement(events, 2300, 4800, true).peakAcceleration).toBeLessThan(3);
  });
});

describe("reported recording regression", () => {
  // Only timing and pointer geometry are retained; keys are replaced with KeyA.
  const events = parseTelemetry(readFileSync(join(process.cwd(), "tests/fixtures/zoom-motion/input.jsonl"), "utf8"));
  it("does not create the scroll-only shot and removes large one-frame jumps", () => {
    const result = movement(events, 0, 43108);
    const clicks = new Set(events.filter(e => e.k === "down").map(e => e.t));
    expect(result.segments.every(s => clicks.has(s.startMs))).toBe(true);
    expect(result.segments.some(s => s.startMs > 19000 && s.startMs < 30000)).toBe(false);
    // Previously: 296.94 px and 0.4676 scale in a single 60 Hz frame.
    expect(result.peakPan).toBeLessThan(45);
    expect(result.peakDepth).toBeLessThan(0.04);
  });
});
