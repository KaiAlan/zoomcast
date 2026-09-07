import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { maxComfortableZoom } from "./geometry";
import { zoomAt } from "./interpolate";
import { depthToScale, scaleToDepth, segmentsToKeyframes } from "./keyframes";
import type { PlanContext, ZoomSegment } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
  durationMs: 60_000,
};

const cfg = DEFAULT_ZOOM_CONFIG;
const CEILING = maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor);

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
    const square = maxComfortableZoom({ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, 0.85);
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
