import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelemetry } from "../bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { planZoom } from "./planner";
import type { PlanContext } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
};

describe("planZoom", () => {
  it("returns nothing for empty telemetry", () => {
    expect(planZoom([], DEFAULT_ZOOM_CONFIG, ctx)).toEqual([]);
  });

  it("emits an in/out keyframe pair per surviving cluster", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs).toHaveLength(2);
    expect(kfs[0]?.scale).toBeGreaterThan(1);
    expect(kfs[1]?.scale).toBe(1);
  });

  it("leads the zoom in and trails it out", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.tSourceMs).toBe(750); // 1000 - leadInMs 250
    expect(kfs[1]?.tSourceMs).toBe(1400); // 1000 + trailMs 400
  });

  it("never leads in before zero", () => {
    const kfs = planZoom(
      [{ t: 10, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.tSourceMs).toBe(0);
  });

  it("normalises the focus point to 0..1 of the source", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 960, y: 540, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.cx).toBeCloseTo(0.5, 6);
    expect(kfs[0]?.cy).toBeCloseTo(0.5, 6);
  });

  it("never exceeds the comfortable zoom ceiling for the source", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    for (const k of kfs) {
      expect(k.scale).toBeLessThanOrEqual(1.177);
    }
  });

  it("marks generated keyframes as auto and unpinned with stable ids", () => {
    const events = [{ t: 1000, k: "down" as const, x: 500, y: 400, b: 1 }];
    const a = planZoom(events, DEFAULT_ZOOM_CONFIG, ctx);
    const b = planZoom(events, DEFAULT_ZOOM_CONFIG, ctx);
    expect(a[0]?.origin).toBe("auto");
    expect(a[0]?.pinned).toBe(false);
    expect(a.map((k) => k.id)).toEqual(b.map((k) => k.id));
  });

  describe("over the basic fixture", () => {
    const kfs = planZoom(
      parseTelemetry(
        readFileSync(
          join(process.cwd(), "tests", "fixtures", "basic", "input.jsonl"),
          "utf8",
        ),
      ),
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );

    it("produces keyframes in time order", () => {
      const times = kfs.map((k) => k.tSourceMs);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(kfs.length).toBeGreaterThan(0);
    });

    it("holds each zoom for at least minHoldMs before starting another", () => {
      const zoomIns = kfs.filter((k) => k.scale > 1).map((k) => k.tSourceMs);
      for (let i = 1; i < zoomIns.length; i++) {
        const gap = (zoomIns[i] ?? 0) - (zoomIns[i - 1] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(DEFAULT_ZOOM_CONFIG.minHoldMs);
      }
    });
  });
});
