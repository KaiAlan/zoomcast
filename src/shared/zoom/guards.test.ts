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
  intentScores: { click: 1, key: 0, wheel: 0 },
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
      60_000,
    );
    expect(out).toHaveLength(2);
  });

  it("merges a cluster inside the deadzone into the previous one", () => {
    // 60px apart, well inside deadzonePx 120
    const out = applyGuards(
      [cluster(0, 100, 500, 500), cluster(5000, 5100, 560, 500)],
      cfg,
      60_000,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.endT).toBe(5100);
  });

  it("merges a cluster that arrives before minHoldMs elapses", () => {
    // 800ms after the previous START, under minHoldMs 1500, though far in space
    const out = applyGuards(
      [cluster(0, 100, 200, 200), cluster(800, 900, 1600, 900)],
      cfg,
      60_000,
    );
    expect(out).toHaveLength(1);
  });

  it("caps zooms per minute, keeping the heaviest", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [
        cluster(0, 10, 100, 100, 1),
        cluster(30_000, 30_010, 600, 100, 5),
        cluster(31_000, 31_010, 1100, 100, 3),
      ],
      tight,
      60_000,
    );
    expect(out.map((c) => c.weight)).toEqual([1, 5]);
  });

  it("returns rate-limited clusters in time order", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [cluster(2000, 2010, 600, 100, 5), cluster(40_000, 40_010, 1100, 100, 3)],
      tight,
      60_000,
    );
    expect(out.map((c) => c.startT)).toEqual([2000, 40_000]);
  });

  describe("rate limit", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 8, minHoldMs: 0, deadzonePx: 0 };

    it("scales the budget by how long the take actually is", () => {
      // 30s of a maxZoomsPerMinute-8 budget is 4, not 8
      const cs = Array.from({ length: 8 }, (_, i) =>
        cluster(i * 3750, i * 3750 + 10, 100 + i * 200, 100, 8 - i),
      );
      expect(applyGuards(cs, tight, 30_000)).toHaveLength(4);
    });

    it("keeps at least one zoom however short the take", () => {
      const cs = [cluster(0, 10, 100, 100, 1), cluster(1000, 1010, 900, 100, 5)];
      expect(applyGuards(cs, tight, 2000)).toHaveLength(1);
    });

    it("spends the budget across the take instead of on one busy stretch", () => {
      // Four heavy clusters bunched at the start, three light ones spread out.
      // Dropping lowest-weight-first would spend the whole budget on the bunch
      // and leave the rest of the take flat.
      const cs = [
        cluster(0, 10, 100, 100, 5),
        cluster(1000, 1010, 500, 100, 4.9),
        cluster(2000, 2010, 900, 100, 4.8),
        cluster(3000, 3010, 1300, 100, 4.7),
        cluster(20_000, 20_010, 300, 600, 1),
        cluster(35_000, 35_010, 700, 600, 1),
        cluster(50_000, 50_010, 1100, 600, 1),
      ];
      const out = applyGuards(cs, { ...tight, maxZoomsPerMinute: 4 }, 60_000);
      expect(out.map((c) => c.startT)).toEqual([0, 20_000, 35_000, 50_000]);
    });

    it("keeps the heaviest cluster within each stretch", () => {
      const cs = [
        cluster(0, 10, 100, 100, 1),
        cluster(5000, 5010, 500, 100, 9),
        cluster(40_000, 40_010, 900, 100, 2),
      ];
      const out = applyGuards(cs, { ...tight, maxZoomsPerMinute: 2 }, 60_000);
      expect(out.map((c) => c.weight)).toEqual([9, 2]);
    });
  });
});
