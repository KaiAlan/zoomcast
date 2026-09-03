import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { applyGuards } from "./guards";
import type { Cluster } from "./types";

const cfg = DEFAULT_ZOOM_CONFIG;

const cluster = (
  startT: number,
  endT: number,
  cx: number,
  cy: number,
  weight = 1,
): Cluster => ({
  startT,
  endT,
  cx,
  cy,
  weight,
  minX: cx - 50,
  maxX: cx + 50,
  minY: cy - 50,
  maxY: cy + 50,
  anchorIndex: startT,
});

describe("applyGuards", () => {
  it("keeps well-separated clusters", () => {
    const out = applyGuards(
      [cluster(0, 100, 200, 200), cluster(5000, 5100, 1600, 900)],
      cfg,
    );
    expect(out).toHaveLength(2);
  });

  it("merges a cluster inside the deadzone into the previous one", () => {
    // 60px apart, well inside deadzonePx 120
    const out = applyGuards(
      [cluster(0, 100, 500, 500), cluster(5000, 5100, 560, 500)],
      cfg,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.endT).toBe(5100);
  });

  it("merges a cluster that arrives before minHoldMs elapses", () => {
    // 800ms after the previous START, under minHoldMs 1500, though far in space
    const out = applyGuards(
      [cluster(0, 100, 200, 200), cluster(800, 900, 1600, 900)],
      cfg,
    );
    expect(out).toHaveLength(1);
  });

  it("caps zooms per minute, keeping the heaviest", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [
        cluster(0, 10, 100, 100, 1),
        cluster(2000, 2010, 600, 100, 5),
        cluster(4000, 4010, 1100, 100, 3),
      ],
      tight,
    );
    expect(out.map((c) => c.weight)).toEqual([5, 3]);
  });

  it("returns rate-limited clusters in time order", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [cluster(2000, 2010, 600, 100, 5), cluster(4000, 4010, 1100, 100, 3)],
      tight,
    );
    expect(out.map((c) => c.startT)).toEqual([2000, 4000]);
  });
});
