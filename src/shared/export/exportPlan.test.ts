import { describe, expect, it } from "vitest";
import type { Cut } from "../project/types";
import { planExportFrames } from "./exportPlan";

describe("planExportFrames", () => {
  it("emits fps frames per second with no cuts", () => {
    expect(planExportFrames(1000, [], 60)).toHaveLength(60);
  });

  it("starts at output time zero mapping to source zero", () => {
    expect(planExportFrames(1000, [], 60)[0]).toEqual({
      index: 0,
      tOutputMs: 0,
      tSourceMs: 0,
    });
  });

  it("shortens the frame count by the cut length", () => {
    const cuts: Cut[] = [{ id: "c1", startMs: 200, endMs: 400 }];
    expect(planExportFrames(1000, cuts, 60)).toHaveLength(48); // 800ms at 60fps
  });

  it("skips over the cut in source time", () => {
    const cuts: Cut[] = [{ id: "c1", startMs: 200, endMs: 400 }];
    const atCut = planExportFrames(1000, cuts, 60).find((f) => f.tOutputMs === 200);
    expect(atCut?.tSourceMs).toBe(400);
  });

  it("never emits a source time inside a cut", () => {
    const cuts: Cut[] = [{ id: "c1", startMs: 200, endMs: 400 }];
    for (const f of planExportFrames(1000, cuts, 60)) {
      expect(f.tSourceMs >= 200 && f.tSourceMs < 400).toBe(false);
    }
  });

  it("numbers frames consecutively from zero", () => {
    const frames = planExportFrames(500, [], 30);
    expect(frames.map((f) => f.index)).toEqual(frames.map((_, i) => i));
  });

  it("advances output time by exactly one frame interval", () => {
    const frames = planExportFrames(1000, [], 25);
    expect(frames[1]?.tOutputMs).toBeCloseTo(40, 6);
    expect(frames[10]?.tOutputMs).toBeCloseTo(400, 6);
  });

  it("returns nothing for a fully cut recording", () => {
    expect(planExportFrames(1000, [{ id: "c1", startMs: 0, endMs: 1000 }], 60)).toEqual([]);
  });
});
