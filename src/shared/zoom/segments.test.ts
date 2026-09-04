import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { applySegmentGuards, type Segment } from "./segments";
import type { ZoomConfig } from "./types";

const cfg: ZoomConfig = {
  ...DEFAULT_ZOOM_CONFIG,
  minDwellMs: 1400,
  minRecoveryMs: 700,
};

const seg = (startT: number, endT: number, cx = 500, cy = 500): Segment => ({
  startT,
  endT,
  waypoints: [{ id: `k${startT}`, t: startT, scale: 1.176, cx, cy }],
});

describe("applySegmentGuards", () => {
  it("leaves well-separated, long-enough segments alone", () => {
    const out = applySegmentGuards([seg(0, 3000), seg(6000, 9000, 1400, 800)], cfg);
    expect(out).toEqual([seg(0, 3000), seg(6000, 9000, 1400, 800)]);
  });

  describe("recovery", () => {
    it("merges two segments separated by less than minRecoveryMs", () => {
      const out = applySegmentGuards([seg(0, 3000), seg(3200, 6000, 1400, 800)], cfg);
      expect(out).toHaveLength(1);
      expect(out[0]?.startT).toBe(0);
      expect(out[0]?.endT).toBe(6000);
    });

    it("keeps a waypoint for each merged segment so the camera travels", () => {
      const out = applySegmentGuards([seg(0, 3000), seg(3200, 6000, 1400, 800)], cfg);
      expect(out[0]?.waypoints).toHaveLength(2);
      expect(out[0]?.waypoints[1]).toMatchObject({ t: 3200, cx: 1400, cy: 800 });
    });

    it("never emits a scale-1 keyframe inside a merged segment", () => {
      const out = applySegmentGuards([seg(0, 3000), seg(3200, 6000, 1400, 800)], cfg);
      for (const w of out[0]?.waypoints ?? []) expect(w.scale).toBeGreaterThan(1);
    });

    it("chains a run of segments that are each too close to the last", () => {
      const out = applySegmentGuards(
        [seg(0, 2000), seg(2300, 4000, 900, 500), seg(4200, 6000, 1400, 800)],
        cfg,
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.waypoints).toHaveLength(3);
      expect(out[0]?.endT).toBe(6000);
    });

    it("splits when the gap reaches minRecoveryMs exactly", () => {
      const out = applySegmentGuards([seg(0, 3000), seg(3700, 6000, 1400, 800)], cfg);
      expect(out).toHaveLength(2);
    });
  });

  describe("dwell", () => {
    it("extends a segment that would hold for less than minDwellMs", () => {
      const out = applySegmentGuards([seg(0, 800)], cfg);
      expect(out).toHaveLength(1);
      expect(out[0]?.endT).toBe(1400);
    });

    it("does not extend into the next segment's recovery gap", () => {
      // next starts at 3000, so this may run to 3000 - 700 = 2300
      const out = applySegmentGuards([seg(1000, 1800), seg(3000, 6000, 1400, 800)], cfg);
      expect(out[0]?.endT).toBe(2300);
    });

    it("drops a segment that can neither dwell nor merge", () => {
      // 200ms of dwell available before the next segment's recovery gap:
      // too short to hold, too far to merge.
      const out = applySegmentGuards([seg(1000, 1100), seg(1900, 6000, 1400, 800)], cfg);
      expect(out).toHaveLength(1);
      expect(out[0]?.startT).toBe(1900);
    });

    it("extends the last segment freely", () => {
      const out = applySegmentGuards([seg(0, 3000), seg(6000, 6100, 1400, 800)], cfg);
      expect(out[1]?.endT).toBe(7400);
    });
  });

  it("returns segments in time order", () => {
    const out = applySegmentGuards(
      [seg(0, 900), seg(5000, 5400, 1400, 800), seg(9000, 12000, 300, 300)],
      cfg,
    );
    const times = out.map((s) => s.startT);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("handles an empty plan", () => {
    expect(applySegmentGuards([], cfg)).toEqual([]);
  });
});
