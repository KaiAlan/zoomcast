import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { defaultProject } from "../project/defaults";
import { buildCursorPath, cursorAt } from "../cursor/path";
import { parseTelemetry } from "../bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { adaptiveCamera, contextIsVisible, fitContext } from "./adaptive";
import { chooseControlContext } from "./context";
import { replanFrom } from "./derive";
import { zoomAt } from "./interpolate";
import { projectKeyframes } from "./viewport";
import type { PlanContext, ZoomSegment } from "./types";

const ctx: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 }, paddingFactor: 0.85, durationMs: 6000 };
const segment: ZoomSegment = { id: "shot", startMs: 0, endMs: 6000, origin: "auto", pinned: false, position: "follow", waypoints: [{ id: "first", tMs: 0, depth: cfg.depthClick, cx: 0.5, cy: 0.5 }] };
const rect = { x: 200, y: 80, w: 1100, h: 70 };
const normalized = (r: typeof rect) => ({ x: r.x / ctx.source.w, y: r.y / ctx.source.h, w: r.w / ctx.source.w, h: r.h / ctx.source.h });
const down = (t: number, x: number, y: number): TelemetryEvent => ({ t, k: "down", x, y, b: 1 });
const context = (t: number, r: typeof rect, trigger: "down" | "key" | "wheel" = "down"): TelemetryEvent => ({ t, k: "context", trigger, target: { role: trigger === "key" ? "Edit" : "ToolBar", rect: r } });

describe("control context", () => {
  const capture = { x: -1920, y: 0, w: 1920, h: 1080 };
  const button = { role: "Button", rect: { x: -1720, y: 80, w: 40, h: 40 } };
  it("frames an entire toolbar instead of its tiny button, including negative monitor coordinates", () => {
    expect(chooseControlContext([button, { role: "ToolBar", rect: { ...rect, x: rect.x - 1920 } }], capture, { x: -1700, y: 100 }))
      .toEqual({ role: "ToolBar", rect });
  });
  for (const role of ["Menu", "MenuBar", "List", "Tree", "DataGrid", "Tab", "Table", "Header", "StatusBar", "AppBar", "Group", "Pane", "Custom"]) {
    it(`uses the relevant ${role} container in browser or native applications`, () => {
      expect(chooseControlContext([button, { role, rect: { x: -1750, y: 50, w: 500, h: 200 } }], capture)?.role).toBe(role);
    });
  }
  for (const role of ["Edit", "ComboBox", "Slider", "Spinner", "Calendar"]) {
    it(`retains complete ${role} bounds`, () => {
      const field = { role, rect: { x: -1800, y: 100, w: 800, h: 150 } };
      expect(chooseControlContext([field, { role: "Pane", rect: { ...capture, x: -1900, w: 1800 } }], capture)?.role).toBe(role);
    });
  }
  it("frames a dropdown's arrow and input together instead of its inner edit", () => {
    expect(chooseControlContext([{ role: "Edit", rect: { x: -1720, y: 80, w: 300, h: 20 } },
      { role: "ComboBox", rect: { x: -1722, y: 78, w: 350, h: 25 } }], capture)?.role).toBe("ComboBox");
  });
  it("falls back for an opaque/full-screen canvas or an off-capture window", () => {
    expect(chooseControlContext([{ role: "Document", rect: capture }, { role: "Custom", rect: capture }], capture)).toBeNull();
    expect(chooseControlContext([{ role: "Edit", rect: { x: 2000, y: 0, w: 500, h: 100 } }], capture)).toBeNull();
  });
  it("rejects malformed context without breaking old telemetry", () => {
    const lines = [down(10, 20, 30), context(10, rect), context(20, { ...rect, w: -2 }), { t: 0, k: "context", trigger: "other", target: {} }];
    expect(parseTelemetry(lines.map(value => JSON.stringify(value)).join("\n"))).toEqual(lines.slice(0, 2));
  });
});

describe("actual viewport fitting", () => {
  for (const output of [{ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, { w: 1080, h: 1920 }, { w: 2560, h: 1080 }]) {
    for (const r of [rect, { x: 0, y: 0, w: 1800, h: 70 }, { x: 1300, y: 700, w: 620, h: 380 }, { x: 400, y: 300, w: 800, h: 500 }]) {
      it(`fits complete control ${r.x},${r.y} in ${output.w}x${output.h}`, () => {
        const plan = { ...ctx, output };
        const target = normalized(r);
        const fit = fitContext(target, 2.4, { cx: 0.5, cy: 0.5 }, plan);
        expect(fit.scale).toBeGreaterThanOrEqual(1);
        expect(contextIsVisible(target, fit, plan)).toBe(true);
      });
    }
  }
});

describe("adaptive automatic camera", () => {
  it("keeps the whole toolbar visible and changes depth within the same shot", () => {
    const field = { x: 760, y: 410, w: 350, h: 150 };
    const events = [down(100, 300, 100), context(100, rect), down(3000, 850, 460), context(3000, field)];
    const frames = projectKeyframes(adaptiveCamera(events, cfg, ctx)(segment), ctx);
    for (const t of [1500, 2200, 2800]) expect(contextIsVisible(normalized(rect), zoomAt(frames, t), ctx)).toBe(true);
    expect(zoomAt(frames, 4400).scale).toBeGreaterThan(zoomAt(frames, 2200).scale + 0.1);
    expect(contextIsVisible(normalized(field), zoomAt(frames, 4400), ctx)).toBe(true);
  });
  it("keeps typing in the focused field when the cursor moves to another corner", () => {
    const field = { x: 650, y: 400, w: 650, h: 240 };
    const events: TelemetryEvent[] = [down(100, 850, 450), context(100, field), { t: 2000, k: "move", x: 20, y: 20 }];
    for (let t = 1800; t <= 4000; t += 200) events.push({ t, k: "key", d: "down", c: "30" }, context(t, field, "key"));
    events.sort((a, b) => a.t - b.t);
    const frames = projectKeyframes(adaptiveCamera(events, cfg, ctx)(segment), ctx);
    for (const t of [2500, 3200, 3900]) {
      expect(contextIsVisible(normalized(field), zoomAt(frames, t), ctx)).toBe(true);
      expect(zoomAt(frames, t).scale).toBeGreaterThan(1.5);
    }
  });
  it("keeps rapid opposite-corner clicks visible at their exact timestamps", () => {
    const events = [down(100, 900, 500), down(2513, 40, 30), down(2577, 1850, 1010), down(2639, 50, 1020)];
    const frames = projectKeyframes(adaptiveCamera(events, cfg, ctx)(segment), ctx);
    for (const e of events) if (e.k === "down") {
      expect(contextIsVisible({ x: e.x / 1920, y: e.y / 1080, w: 0, h: 0 }, zoomAt(frames, e.t), ctx)).toBe(true);
    }
  });
  it("uses the production derivation and preserves a manually claimed shot", () => {
    const events = [down(1000, 300, 100), context(1000, rect), down(2200, 350, 110), context(2200, rect)];
    const project = defaultProject("semantic-test");
    const derived = replanFrom(cfg, project, { source: ctx.source, durationMs: 6000, telemetry: events, cameraPath: null });
    expect(derived.keyframes.length).toBeGreaterThan(60);
    expect(contextIsVisible(normalized(rect), zoomAt(derived.keyframes, 2600), ctx)).toBe(true);
    project.zoom.segments = [{ ...segment, position: "fixed", pinned: true, origin: "manual" }];
    const manual = replanFrom(cfg, project, { source: ctx.source, durationMs: 6000, telemetry: events, cameraPath: null });
    expect(manual.keyframes.every(f => f.origin === "manual")).toBe(true);
    expect(manual.keyframes.length).toBeLessThan(5);
  });
  it("places the drawn cursor at every click even between path grid samples", () => {
    const events = [down(0, 0, 0), down(101, 1700, 100), down(106, 200, 900)];
    const path = buildCursorPath(events, { halfLifeMs: 72, sampleHz: 120, pinClicks: true });
    expect(cursorAt(path, 101)).toMatchObject({ x: 1700, y: 100 });
    expect(cursorAt(path, 106)).toMatchObject({ x: 200, y: 900 });
  });
});
