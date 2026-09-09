import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { applySegmentGuards, type Segment } from "./segments";
import type { PlanContext, ZoomConfig } from "./types";

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

  describe("activity that keeps going", () => {
    it("holds the zoom for as long as the activity lasts", () => {
      // Regression: a `maxDwellMs` cap truncated a segment whose activity was
      // still running. On a real take the camera pulled out at 6.62s exactly
      // as a 26-second typing run began, and never came back — the cluster was
      // already spent. The cap came from misreading Recordly's
      // MAX_DWELL_DURATION_MS, which filters cursor-dwell CANDIDATES rather
      // than capping how long a zoom holds.
      const out = applySegmentGuards([seg(0, 20_000)], cfg);

      expect(out).toHaveLength(1);
      expect(out[0]?.endT).toBe(20_000);
    });
  });

  describe("the floor", () => {
    it("is the zoom-out, not both transitions", () => {
      // The zoom-in eases into startT from BEFORE it, so it cannot constrain
      // how long the segment lasts. Only the zoom-out is paid from inside.
      const c = { ...cfg, transitionMs: 1500, transitionOutMs: 1000, minDwellMs: 0 };
      expect(applySegmentGuards([seg(0, 1200)], c)).toHaveLength(1);
    });

    it("drops a segment with no room to leave", () => {
      const c = { ...cfg, transitionMs: 1500, transitionOutMs: 1000, minDwellMs: 0 };
      expect(applySegmentGuards([seg(0, 800)], c)).toHaveLength(0);
    });
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

/**
 * Measured over the 13 takes on disk on 2026-09-08: 12 of 17 interior triples
 * reverse direction, median detour 728px. Most are fine — the camera rests
 * three to five seconds at the middle waypoint. The two that read as a wobble
 * barely rest at all.
 */
describe("doubling back inside one shot", () => {
  const ctx: PlanContext = {
    source: { w: 1920, h: 1080 },
    output: { w: 1920, h: 1080 },
    paddingFactor: 0.85,
    durationMs: 90_000,
  };

  /** The real shape, from 2026-09-07T17-22-48: cx 0.319 -> 0.608 -> 0.449. */
  const travelling = (cs: number[], ts: number[], scale = 1.25): Segment => ({
    startT: ts[0] ?? 0,
    endT: (ts[ts.length - 1] ?? 0) + 3000,
    waypoints: cs.map((cx, i) => ({
      id: `k${i}`,
      t: ts[i] ?? 0,
      scale,
      cx,
      cy: 0.5,
    })),
  });

  const centres = (s: Segment | undefined): number[] =>
    (s?.waypoints ?? []).map((w) => w.cx);

  it("drops a waypoint the camera comes straight back from", () => {
    // 1064ms of rest once the 1000ms move out is paid for — under minDwellMs.
    const out = applySegmentGuards([travelling([0.319, 0.608, 0.449], [0, 14102, 16166])], cfg, ctx);

    expect(centres(out[0])).toEqual([0.319, 0.449]);
  });

  it("keeps one the camera actually rests at", () => {
    const out = applySegmentGuards([travelling([0.319, 0.608, 0.449], [0, 14102, 19000])], cfg, ctx);

    expect(centres(out[0])).toEqual([0.319, 0.608, 0.449]);
  });

  it("keeps a waypoint that carries on in the same direction", () => {
    const out = applySegmentGuards([travelling([0.3, 0.5, 0.7], [0, 14102, 16166])], cfg, ctx);

    expect(centres(out[0])).toEqual([0.3, 0.5, 0.7]);
  });

  /**
   * The trip is what goes, never the sight of what happened there.
   *
   * At scale 2 the camera has full lateral authority and the frame is 1.7x the
   * output, so a waypoint 0.8 of the source away is genuinely off screen from
   * both neighbours. Below `1 / paddingFactor * 1.4` — see lateralAuthority —
   * the camera barely pans and almost nothing is ever off screen, which is
   * itself a reason the trip is not worth taking.
   */
  it("keeps one whose activity would otherwise never be seen", () => {
    const out = applySegmentGuards(
      [travelling([0.1, 0.9, 0.5], [0, 14102, 16166], 2)],
      cfg,
      ctx,
    );

    expect(centres(out[0])).toEqual([0.1, 0.9, 0.5]);
  });

  it("repeats until nothing more comes out", () => {
    const out = applySegmentGuards(
      [travelling([0.30, 0.58, 0.42, 0.60, 0.45], [0, 4000, 6000, 8000, 10_000])],
      cfg,
      ctx,
    );

    expect(centres(out[0]).length).toBeLessThan(5);
  });

  it("does nothing without a context, because nothing can be judged visible", () => {
    const out = applySegmentGuards([travelling([0.319, 0.608, 0.449], [0, 14102, 16166])], cfg);

    expect(centres(out[0])).toEqual([0.319, 0.608, 0.449]);
  });

  it("never touches the first or last waypoint", () => {
    const out = applySegmentGuards([travelling([0.319, 0.608, 0.449], [0, 14102, 16166])], cfg, ctx);
    const ws = out[0]?.waypoints ?? [];

    expect(ws[0]?.cx).toBe(0.319);
    expect(ws[ws.length - 1]?.cx).toBe(0.449);
  });
});
