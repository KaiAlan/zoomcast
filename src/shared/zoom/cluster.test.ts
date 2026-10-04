import { describe, expect, it } from "vitest";
import { absorbCluster, clusterImpulses, clusterIntent, mergeAndFilter } from "./cluster";
import { DEFAULT_DEPTH_CONFIG } from "./depth";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import type { Cluster, Impulse } from "./types";

const cfg = DEFAULT_ZOOM_CONFIG;

const imp = (
  t: number,
  x: number,
  y: number,
  w = 1,
  srcIndex = 0,
  kind: Impulse["kind"] = "click",
): Impulse => ({
  kind,
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
    // Two nearby weak bursts split by a short cluster window qualify
    // together without averaging distant activity into the screen centre.
    const cs = clusterImpulses(
      [imp(100, 100, 100, 0.5), imp(400, 150, 100, 0.5)],
      { ...cfg, clusterWindowMs: 200 },
    );
    expect(cs).toHaveLength(2);

    const merged = mergeAndFilter(cs, cfg);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.weight).toBe(1);
  });
});

describe("clusterIntent", () => {
  const depthCfg = DEFAULT_DEPTH_CONFIG;
  const clusterOf = (imps: Impulse[]): Cluster =>
    clusterImpulses(imps, DEFAULT_ZOOM_CONFIG)[0] as Cluster;

  it("calls a lone click a click", () => {
    expect(clusterIntent(clusterOf([imp(0, 500, 400, 1, 0, "click")]), depthCfg)).toBe("click");
  });

  /**
   * The case the design cares about: people click into a field before typing
   * into it, and a typing run wants CONTEXT, not the deepest zoom available.
   * One click scores 1.0 against twenty keystrokes at 8.0.
   */
  it("calls a typing run opened by a click a typing run", () => {
    const imps = [
      imp(0, 500, 400, 1, 0, "click"),
      ...Array.from({ length: 20 }, (_, i) => imp(i * 50, 500, 400, 0.4, i + 1, "key")),
    ];
    expect(clusterIntent(clusterOf(imps), depthCfg)).toBe("type");
  });

  it("calls a scroll burst a scroll", () => {
    const imps = Array.from({ length: 6 }, (_, i) => imp(i * 40, 500, 400, 0.3, i, "wheel"));
    expect(clusterIntent(clusterOf(imps), depthCfg)).toBe("scroll");
  });

  /** Deterministic, and it errs toward context: too much is recoverable. */
  it("breaks a tie toward the shallower intent", () => {
    const c = clusterOf([imp(0, 500, 400, 1, 0, "click")]);
    // 1 click scores 1.0; 2.5 keys score 1.0 as well.
    c.intentScores.key = 2.5;
    expect(clusterIntent(c, depthCfg)).toBe("type");
  });

  it("counts kinds rather than weights, so weights stay tunable", () => {
    const c = clusterOf([
      imp(0, 500, 400, 1, 0, "click"),
      imp(10, 500, 400, 0.4, 1, "key"),
      imp(20, 500, 400, 0.4, 2, "key"),
    ]);
    expect(c.intentScores).toEqual({ click: 1, key: 2, wheel: 0 });
  });

  it("keeps its own scores when clusters merge", () => {
    // A shallow spread would have two clusters sharing one scores object.
    const a = clusterOf([imp(0, 500, 400, 1, 0, "click")]);
    const b = clusterOf([imp(10, 500, 400, 1, 1, "click")]);
    absorbCluster(a, b);
    expect(b.intentScores.click).toBe(1);
    expect(a.intentScores.click).toBe(2);
  });
});
