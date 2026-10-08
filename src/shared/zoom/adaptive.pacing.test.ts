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
  let lastVelocity = { x: 0, y: 0 };
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
    expect(result.peakPan).toBeLessThan(22);
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
