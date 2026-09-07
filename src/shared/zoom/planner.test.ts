import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelemetry } from "../bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { segmentsToKeyframes } from "./keyframes";
import { planZoom } from "./planner";
import type { PlanContext } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
  durationMs: 60_000,
};

/**
 * planZoom emits segments; every assertion here is about what they render as,
 * so derive the keyframes at the call.
 */
function plan(
  events: Parameters<typeof planZoom>[0],
  cfg: Parameters<typeof planZoom>[1],
  c: PlanContext,
): ReturnType<typeof segmentsToKeyframes> {
  return segmentsToKeyframes(planZoom(events, cfg, c), cfg, c);
}

describe("planZoom", () => {
  it("returns nothing for empty telemetry", () => {
    expect(plan([], DEFAULT_ZOOM_CONFIG, ctx)).toEqual([]);
  });

  it("emits an in/out keyframe pair per surviving cluster", () => {
    const kfs = plan(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs).toHaveLength(2);
    expect(kfs[0]?.scale).toBeGreaterThan(1);
    expect(kfs[1]?.scale).toBe(1);
  });

  it("leads the zoom in", () => {
    const kfs = plan(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.tSourceMs).toBe(750); // 1000 - leadInMs 250
  });

  it("holds a lone click for minDwellMs rather than just trailMs", () => {
    // trailMs alone would end this at 1400 — a 650ms hold against 1200ms of
    // transition, which is a twitch, not a shot.
    const kfs = plan(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[1]?.tSourceMs).toBe(750 + DEFAULT_ZOOM_CONFIG.minDwellMs);
  });

  it("travels between two focus points instead of pulling out and back in", () => {
    // A long cluster at 500,500 then a separate one 1000px away, close enough
    // that trailMs and leadInMs would otherwise collide. This is the shape the
    // real 35s take produces at 25.8s.
    const kfs = plan(
      [
        { t: 1000, k: "down", x: 500, y: 500, b: 1 },
        { t: 2500, k: "down", x: 500, y: 500, b: 1 },
        { t: 4000, k: "down", x: 500, y: 500, b: 1 },
        { t: 5000, k: "down", x: 1500, y: 500, b: 1 },
      ],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );

    expect(kfs).toHaveLength(3);
    expect(kfs[0]?.scale).toBeGreaterThan(1);
    expect(kfs[1]?.scale).toBeGreaterThan(1);
    expect(kfs[1]?.cx).toBeCloseTo(1500 / 1920, 6);
    expect(kfs[2]?.scale).toBe(1);
  });

  it("never emits a zoom held for less than its own two transitions", () => {
    const events = [
      { t: 1000, k: "down" as const, x: 500, y: 500, b: 1 },
      { t: 5000, k: "down" as const, x: 1500, y: 900, b: 1 },
      { t: 9000, k: "down" as const, x: 300, y: 200, b: 1 },
    ];
    const kfs = plan(events, DEFAULT_ZOOM_CONFIG, ctx);

    for (let i = 0; i < kfs.length - 1; i++) {
      const k = kfs[i];
      const next = kfs[i + 1];
      if (k === undefined || next === undefined) continue;
      if (k.scale > 1 && next.scale === 1) {
        expect(next.tSourceMs - k.tSourceMs).toBeGreaterThanOrEqual(
          DEFAULT_ZOOM_CONFIG.transitionMs * 2,
        );
      }
    }
  });

  it("never leads in before zero", () => {
    const kfs = plan(
      [{ t: 10, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.tSourceMs).toBe(0);
  });

  it("normalises the focus point to 0..1 of the source", () => {
    const kfs = plan(
      [{ t: 1000, k: "down", x: 960, y: 540, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.cx).toBeCloseTo(0.5, 6);
    expect(kfs[0]?.cy).toBeCloseTo(0.5, 6);
  });

  it("never exceeds the comfortable zoom ceiling for the source", () => {
    const kfs = plan(
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
    const a = plan(events, DEFAULT_ZOOM_CONFIG, ctx);
    const b = plan(events, DEFAULT_ZOOM_CONFIG, ctx);
    expect(a[0]?.origin).toBe("auto");
    expect(a[0]?.pinned).toBe(false);
    expect(a.map((k) => k.id)).toEqual(b.map((k) => k.id));
  });

  describe("over the basic fixture", () => {
    const kfs = plan(
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

    it("leaves at least minRecoveryMs between one zoom ending and the next", () => {
      for (let i = 1; i < kfs.length; i++) {
        const prev = kfs[i - 1];
        const k = kfs[i];
        if (prev?.scale === 1 && k !== undefined && k.scale > 1) {
          expect(k.tSourceMs - prev.tSourceMs).toBeGreaterThanOrEqual(
            DEFAULT_ZOOM_CONFIG.minRecoveryMs,
          );
        }
      }
    });
  });
});
