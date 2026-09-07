import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { pixelParityZoom, screenRect } from "./geometry";
import type { TelemetryEvent } from "../bundle/types";
import { followPath } from "./camera";
import { zoomAt } from "./interpolate";
import { sourceRectFor } from "./viewport";
import { depthToScale, scaleToDepth, segmentsToKeyframes } from "./keyframes";
import type { PlanContext, ZoomSegment } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
  durationMs: 60_000,
};

const cfg = DEFAULT_ZOOM_CONFIG;
const CEILING = pixelParityZoom(ctx.source, ctx.output, ctx.paddingFactor);

function seg(over: Partial<ZoomSegment> = {}): ZoomSegment {
  return {
    id: "s1",
    startMs: 1000,
    endMs: 4000,
    position: "fixed",
    waypoints: [{ id: "k0", tMs: 1000, depth: 1, cx: 0.25, cy: 0.5 }],
    origin: "auto",
    pinned: false,
    ...over,
  };
}

describe("segmentsToKeyframes", () => {
  it("emits the in/out pair the planner used to emit itself", () => {
    const kfs = segmentsToKeyframes([seg()], cfg, ctx);

    expect(kfs).toHaveLength(2);
    expect(kfs[0]).toMatchObject({
      id: "k0i",
      tSourceMs: 1000,
      cx: 0.25,
      cy: 0.5,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });
    expect(kfs[0]?.scale).toBeCloseTo(CEILING, 12);
    // The out-keyframe sits at the segment's end, at rest, where the last
    // waypoint left the camera.
    expect(kfs[1]).toMatchObject({ id: "k0o", tSourceMs: 4000, scale: 1, cx: 0.25 });
  });

  it("emits one in-keyframe per waypoint and a single out-keyframe", () => {
    // A travelling segment: the camera stays in and pans between focus points.
    const kfs = segmentsToKeyframes(
      [
        seg({
          waypoints: [
            { id: "k0", tMs: 1000, depth: 1, cx: 0.25, cy: 0.5 },
            { id: "k1", tMs: 2500, depth: 1, cx: 0.75, cy: 0.5 },
          ],
        }),
      ],
      cfg,
      ctx,
    );

    expect(kfs.map((k) => k.id)).toEqual(["k0i", "k1i", "k1o"]);
    expect(kfs.filter((k) => k.scale === 1)).toHaveLength(1);
  });

  it("sorts by source time", () => {
    const kfs = segmentsToKeyframes(
      [seg({ id: "b", startMs: 6000, endMs: 8000, waypoints: [{ id: "k1", tMs: 6000, depth: 1, cx: 0.5, cy: 0.5 }] }), seg()],
      cfg,
      ctx,
    );

    expect(kfs.map((k) => k.tSourceMs)).toEqual([1000, 4000, 6000, 8000]);
  });

  it("drops a segment with no waypoints rather than emitting a bare pull-out", () => {
    expect(segmentsToKeyframes([seg({ waypoints: [] })], cfg, ctx)).toEqual([]);
  });
});

describe("depth", () => {
  /**
   * Depth is stored relative because the ceiling derives from the output size:
   * a scale planned against 16:9 would be wrong the moment the user picks 1:1.
   */
  it("round-trips a scale through the ceiling", () => {
    expect(depthToScale(scaleToDepth(CEILING, CEILING), CEILING)).toBeCloseTo(CEILING, 12);
    expect(depthToScale(scaleToDepth(1, CEILING), CEILING)).toBeCloseTo(1, 12);
  });

  it("means the same shot at a different output aspect", () => {
    const square = pixelParityZoom({ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, 0.85);
    expect(square).not.toBeCloseTo(CEILING, 3);
    // Full depth is full depth in both: that is the point of storing 0-1.
    expect(depthToScale(1, square)).toBeCloseTo(square, 12);
  });
});

/**
 * Decision 2. A keyframe at t = 0 cannot be eased into — its transition would
 * have to start at -transitionMs — so zoomAt returns the keyframe's own value
 * from the first frame and the take opens as a hard cut.
 */
describe("opening at rest", () => {
  it("never emits a keyframe whose transition would start before zero", () => {
    const segments = [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })];
    const kfs = segmentsToKeyframes(segments, cfg, ctx);

    for (const k of kfs) {
      expect(k.tSourceMs - k.transitionMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("opens at rest, then eases in", () => {
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(zoomAt(kfs, 0).scale).toBe(1);
    expect(zoomAt(kfs, cfg.transitionMs).scale).toBeGreaterThan(1);
  });

  it("keeps the opening move the same speed as every other move", () => {
    // Shortening the transition instead of moving the keyframe would make the
    // first zoom the fastest one in the take, which is the opposite of intent.
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(kfs[0]?.transitionMs).toBe(cfg.transitionMs);
    expect(kfs[0]?.tSourceMs).toBe(cfg.transitionMs);
  });

  it("drops a segment with no room to arrive", () => {
    // A zoom that would have to arrive after its own end is the pathology
    // segments.ts already guards elsewhere.
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 200, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(kfs).toEqual([]);
  });

  it("leaves a segment that already starts late alone", () => {
    const kfs = segmentsToKeyframes([seg()], cfg, ctx);
    expect(kfs[0]?.tSourceMs).toBe(1000);
  });
});

describe("a follow segment", () => {
  // A 1:1 output crops a 16:9 source, which is where a follow has room to pan.
  const square: PlanContext = { ...ctx, output: { w: 1080, h: 1080 } };
  const events: TelemetryEvent[] = [
    { k: "move", t: 0, x: 200, y: 540 },
    { k: "move", t: 1500, x: 1700, y: 540 },
    { k: "move", t: 5000, x: 1700, y: 540 },
  ];
  const path = followPath(events);
  const seg5 = seg({ startMs: 1000, endMs: 5000, position: "follow" });

  it("tracks the cursor between waypoints instead of holding one centre", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const centres = new Set(kfs.filter((k) => k.scale > 1).map((k) => k.cx));

    expect(centres.size).toBeGreaterThan(5);
  });

  it("moves the same way the smoothed path does", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const moving = kfs.filter((k) => k.scale > 1);
    const first = moving[0]?.cx ?? 0;
    const last = moving[moving.length - 1]?.cx ?? 0;

    // The cursor crosses left to right, so the camera does too — lagging it.
    expect(last).toBeGreaterThan(first);
  });

  it("never leaves the source", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);

    const frame = screenRect(square.source, square.output, square.paddingFactor);

    for (const k of kfs.filter((x) => x.scale > 1)) {
      // The bound comes from the geometry the renderer actually samples with,
      // rather than being recomputed here. This test carried its own copy of
      // the old growing-frame formula and had to be rewritten when the geometry
      // changed; deriving it means it cannot drift again.
      const region = sourceRectFor({ scale: k.scale, cx: 0.5, cy: 0.5 }, frame, square.source);
      const half = region.w / 2;
      expect(k.cx).toBeGreaterThanOrEqual(half - 1e-9);
      expect(k.cx).toBeLessThanOrEqual(1 - half + 1e-9);
    }
  });

  it("ramps linearly between samples so the precomputed path is what renders", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const samples = kfs.filter((k) => k.id.includes("f"));

    expect(samples.length).toBeGreaterThan(0);
    for (const k of samples) {
      expect(k.easing).toBe("linear");
      expect(k.transitionMs).toBe(100);
    }
  });

  it("still pulls out at the segment's end", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const last = kfs[kfs.length - 1];

    expect(last?.tSourceMs).toBe(5000);
    expect(last?.scale).toBe(1);
  });

  /**
   * Without a path there is nothing to follow — the tune tool and the planner
   * tests derive keyframes without building one, and must still get a shot.
   */
  it("falls back to its waypoints when no path is supplied", () => {
    const withPath = segmentsToKeyframes([seg5], cfg, square, path);
    const without = segmentsToKeyframes([seg5], cfg, square);

    expect(without).toHaveLength(2);
    expect(without[0]?.cx).toBe(0.25);
    expect(withPath.length).toBeGreaterThan(without.length);
  });

  it("leaves a fixed segment alone even when a path exists", () => {
    expect(segmentsToKeyframes([seg()], cfg, square, path)).toEqual(
      segmentsToKeyframes([seg()], cfg, square),
    );
  });
});
