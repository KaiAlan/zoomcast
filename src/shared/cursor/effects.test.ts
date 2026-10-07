import { describe, expect, it } from "vitest";
import { defaultProject } from "../project/defaults";
import { normalizeProject } from "../project/migrate";
import { outputToSource } from "../project/timeline";
import type { CursorStyle } from "../project/types";
import type { TelemetryEvent } from "../bundle/types";
import { buildCursorPath, cursorAt } from "./path";
import { cursorFrameAt, type CursorTiming } from "./effects";

const style = defaultProject("test").style.cursor;
const events: TelemetryEvent[] = [
  { k: "move", t: 0, x: 10, y: 20 },
  { k: "down", t: 100, x: 10, y: 20, b: 1 },
  { k: "move", t: 500, x: 300, y: 150 },
  { k: "move", t: 2000, x: 400, y: 180 },
];
const path = buildCursorPath(events, { halfLifeMs: 60, sampleHz: 120 });
const clicks = events.filter(e => e.k === "down");
const timing: CursorTiming = { durationMs: 2000, cuts: [], outputMs: 0, fps: 60 };
const frame = (ms: number, overrides: Partial<CursorStyle> = {}, time = timing) => cursorFrameAt(path, clicks, outputToSource(ms, time.durationMs, time.cuts), { ...style, ...overrides }, { ...time, outputMs: ms });

describe("cursor presentation", () => {
  it("holds a late first position through the opening frames, without inventing an empty path", () => {
    const latePath = buildCursorPath([{ k: "move", t: 1800, x: 820, y: 127 }], { halfLifeMs: 60, sampleHz: 120 });
    for (const appearance of ["classic", "rounded", "filled", "dot", "outline"] as const) {
      const opening = cursorFrameAt(latePath, [], 0, { ...style, appearance }, timing);
      expect(opening?.sample).toEqual({ x: 820, y: 127, shape: "arrow" });
      expect(opening?.effects).toEqual({ scale: 1, angleRad: 0, blurX: 0, blurY: 0 });
    }
    const empty = buildCursorPath([{ k: "key", t: 0, c: "65", d: "down" }], { halfLifeMs: 60, sampleHz: 120 });
    expect(cursorFrameAt(empty, [], 0, style, timing)).toBeNull();
  });
  it("preserves legacy cursor positions and disables new effects by default", () => {
    expect(frame(600)?.sample).toEqual(cursorAt(path, 600));
    expect(frame(600)?.effects).toEqual({ scale: 1, angleRad: 0, blurX: 0, blurY: 0 });
    expect(cursorFrameAt(null, clicks, 0, style, timing)).toBeNull();
  });
  it("click bounce settles exactly and responds to duration and strength", () => {
    expect(frame(200, { clickBounce: 3.5 })?.effects.scale).not.toBe(1);
    expect(frame(450, { clickBounce: 3.5 })?.effects.scale).toBe(1);
    expect(frame(200, { clickBounce: 3.5, bounceDurationMs: 100 })?.effects.scale).toBe(1);
    expect(frame(90, { clickBounce: 3.5 })?.effects.scale).toBe(1);
  });
  it("sway and blur follow movement and remain still at rest", () => {
    const moving = frame(550, { motionBlur: 0.4, sway: 0.2 });
    expect(moving?.effects.blurX).toBeGreaterThan(0);
    expect(moving?.effects.angleRad).toBeGreaterThan(0);
    expect(frame(90, { motionBlur: 1, sway: 1 })?.effects.blurX).toBe(0);
  });
  it("sampling after arbitrary seeks has the same result", () => {
    const effects = { motionBlur: 0.4, sway: 0.2, clickBounce: 3.5, loop: true };
    const before = frame(550, effects);
    frame(1800, effects); frame(0, effects);
    expect(frame(550, effects)).toEqual(before);
  });
  it("returns to the first kept cursor position on the final export frame", () => {
    const cuts = [{ id: "trim-start", startMs: 0, endMs: 700 }];
    const edited = { ...timing, cuts };
    const first = frame(0, { loop: true }, edited);
    const last = frame(1300 - 1000 / 60, { loop: true, sway: 1, motionBlur: 1 }, edited);
    expect(last?.sample).toEqual(first?.sample);
    expect(last?.effects).toEqual({ scale: 1, angleRad: 0, blurX: 0, blurY: 0 });
  });
  it("does not blur across removed footage or bounce from a removed click", () => {
    const edited = { ...timing, cuts: [{ id: "cut", startMs: 100, endMs: 600 }] };
    const seam = frame(100, { motionBlur: 1, sway: 1, clickBounce: 5 }, edited);
    expect(seam?.effects).toEqual({ scale: 1, angleRad: 0, blurX: 0, blurY: 0 });
  });
  it("loads old projects with inert effects and round-trips new controls", () => {
    const old = normalizeProject({ style: { cursor: { sizePct: 250, visible: true } } }, "old");
    expect(old.style.cursor).toEqual({ ...style, sizePct: 250 });
    const project = defaultProject("new");
    project.style.cursor = { ...style, appearance: "outline", loop: true, motionBlur: 0.4, clickBounce: 3.5, bounceDurationMs: 350, sway: 0.2 };
    expect(normalizeProject(JSON.parse(JSON.stringify(project)), "new")).toEqual(project);
  });
  it("normalizes malformed controls into safe bounds", () => {
    const c = normalizeProject({ style: { cursor: { appearance: "unknown", motionBlur: 20, clickBounce: -2, bounceDurationMs: 0, sway: NaN, sizePct: 100000 } } }, "bad").style.cursor;
    expect(c.appearance).toBe("filled"); expect(c.motionBlur).toBe(1);
    expect(c.clickBounce).toBe(0); expect(c.bounceDurationMs).toBe(100);
    expect(c.sway).toBe(0); expect(c.sizePct).toBe(500);
  });
});
