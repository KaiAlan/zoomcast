import { describe, expect, it } from "vitest";
import { clusterImpulses, mergeAndFilter } from "./cluster";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import type { Impulse } from "./types";

const cfg = DEFAULT_ZOOM_CONFIG;

const imp = (t: number, x: number, y: number, w = 1, srcIndex = 0): Impulse => ({
  t,
  x,
  y,
  w,
  srcIndex,
});

describe("clusterImpulses", () => {
  it("merges impulses close in time and space", () => {
    const out = clusterImpulses([imp(100, 500, 500), imp(200, 510, 505)], cfg);
    expect(out).toHaveLength(1);
    expect(out[0]?.weight).toBe(2);
    expect(out[0]?.startT).toBe(100);
    expect(out[0]?.endT).toBe(200);
  });

  it("splits impulses far apart in time", () => {
    const out = clusterImpulses([imp(100, 500, 500), imp(5000, 505, 505)], cfg);
    expect(out).toHaveLength(2);
  });

  it("splits impulses far apart in space", () => {
    const out = clusterImpulses([imp(100, 100, 100), imp(200, 1500, 900)], cfg);
    expect(out).toHaveLength(2);
  });

  it("tracks the bounding box of its members", () => {
    const out = clusterImpulses([imp(100, 400, 400), imp(200, 600, 500)], cfg);
    expect(out[0]).toMatchObject({ minX: 400, maxX: 600, minY: 400, maxY: 500 });
  });

  it("keeps the first member's index as the anchor", () => {
    const out = clusterImpulses(
      [imp(100, 500, 500, 1, 7), imp(200, 505, 505, 1, 9)],
      cfg,
    );
    expect(out[0]?.anchorIndex).toBe(7);
  });
});

describe("mergeAndFilter", () => {
  it("drops clusters below the weight threshold", () => {
    const weak = clusterImpulses([imp(100, 500, 500, 0.3)], cfg);
    expect(mergeAndFilter(weak, cfg)).toEqual([]);
  });

  it("keeps clusters at or above the threshold", () => {
    const strong = clusterImpulses([imp(100, 500, 500, 1)], cfg);
    expect(mergeAndFilter(strong, cfg)).toHaveLength(1);
  });

  it("merges clusters separated by less than minGapMs before filtering", () => {
    // two weak clusters, far apart in space so clustering splits them,
    // but only 300ms apart so merging lets their combined weight qualify
    const cs = clusterImpulses(
      [imp(100, 100, 100, 0.5), imp(400, 1500, 900, 0.5)],
      cfg,
    );
    expect(cs).toHaveLength(2);

    const merged = mergeAndFilter(cs, cfg);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.weight).toBe(1);
  });
});
