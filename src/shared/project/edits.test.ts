import { cutLaneSpan } from "./cutLane";
import { describe, expect, it } from "vitest";
import {
  addCut,
  addSegment,
  createCutFromDrag,
  cutDragToSource,
  cutResizeToSource,
  deleteCut,
  deleteSegment,
  minSegmentMs,
  MIN_CUT_MS,
  moveCut,
  moveSegment,
  resetSegment,
  resizeCut,
  resizeSegment,
  segmentDragToSource,
  segmentResizeToSource,
  setSegmentCamera,
  setSegmentDepth,
} from "./edits";
import { defaultProject } from "./defaults";
import { outputDurationMs, sourceSpanToOutput, sourceToOutput } from "./timeline";
import type { Cut, Project } from "./types";
import type { ZoomSegment } from "../zoom/types";

const DURATION = 30_000;

function seg(id: string, startMs: number, endMs: number): ZoomSegment {
  return {
    id,
    startMs,
    endMs,
    position: "fixed",
    waypoints: [
      { id: `${id}-w1`, tMs: startMs + 500, depth: 0.5, cx: 0.5, cy: 0.5 },
      { id: `${id}-w2`, tMs: startMs + 1500, depth: 0.5, cx: 0.6, cy: 0.4 },
    ],
    origin: "auto",
    pinned: false,
  };
}

function withSegments(segments: ZoomSegment[]): Project {
  const base = defaultProject("test-bundle");
  return { ...base, zoom: { ...base.zoom, segments, keyframes: [] } };
}

/** Like `seg`, but with waypoints at explicit times instead of the fixed offsets. */
function segWithWaypoints(id: string, startMs: number, endMs: number, waypointMs: number[]): ZoomSegment {
  return {
    id,
    startMs,
    endMs,
    position: "fixed",
    waypoints: waypointMs.map((tMs, i) => ({
      id: `${id}-w${i}`,
      tMs,
      depth: 0.5,
      cx: 0.5,
      cy: 0.5,
    })),
    origin: "auto",
    pinned: false,
  };
}

const find = (p: Project, id: string): ZoomSegment =>
  p.zoom.segments.find((s) => s.id === id) as ZoomSegment;

describe("minSegmentMs", () => {
  it("is the settle plus the pull-out, from the live config", () => {
    const cfg = defaultProject("b").zoom.config;
    expect(minSegmentMs(cfg)).toBe(Math.max(cfg.transitionMs, cfg.zoomInOverlapMs) + cfg.transitionOutMs);
  });
});

describe("moveSegment", () => {
  it("shifts both edges and pins", () => {
    const p = moveSegment(withSegments([seg("a", 5000, 9000)]), "a", 1000, DURATION);
    expect(find(p, "a").startMs).toBe(6000);
    expect(find(p, "a").endMs).toBe(10_000);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("shifts the waypoints with the segment", () => {
    const p = moveSegment(withSegments([seg("a", 5000, 9000)]), "a", 1000, DURATION);
    expect(find(p, "a").waypoints.map((w) => w.tMs)).toEqual([6500, 7500]);
  });

  it("clamps at zero without shrinking", () => {
    const p = moveSegment(withSegments([seg("a", 1000, 5000)]), "a", -4000, DURATION);
    expect(find(p, "a").startMs).toBe(0);
    expect(find(p, "a").endMs).toBe(4000);
  });

  it("clamps at the take end without shrinking", () => {
    const p = moveSegment(withSegments([seg("a", 25_000, 29_000)]), "a", 5000, DURATION);
    expect(find(p, "a").endMs).toBe(DURATION);
    expect(find(p, "a").startMs).toBe(26_000);
  });

  it("stops at the following neighbour rather than overlapping it", () => {
    const p = moveSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]),
      "a",
      5000,
      DURATION,
    );
    expect(find(p, "a").endMs).toBe(8000);
    expect(find(p, "a").startMs).toBe(4000);
  });

  it("stops at the preceding neighbour rather than overlapping it", () => {
    const p = moveSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]),
      "b",
      -5000,
      DURATION,
    );
    expect(find(p, "b").startMs).toBe(6000);
    expect(find(p, "b").endMs).toBe(10_000);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withSegments([seg("a", 2000, 6000)]);
    expect(moveSegment(p, "nope", 1000, DURATION)).toBe(p);
  });
});

describe("resizeSegment", () => {
  it("moves the start edge and pins", () => {
    const p = resizeSegment(withSegments([seg("a", 5000, 12_000)]), "a", "start", 7000, DURATION);
    expect(find(p, "a").startMs).toBe(7000);
    expect(find(p, "a").endMs).toBe(12_000);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("stops the start edge at the minimum length", () => {
    const p0 = withSegments([seg("a", 5000, 12_000)]);
    const min = minSegmentMs(p0.zoom.config);
    const p = resizeSegment(p0, "a", "start", 11_900, DURATION);
    expect(find(p, "a").startMs).toBe(12_000 - min);
  });

  it("stops the end edge at the minimum length", () => {
    const p0 = withSegments([seg("a", 5000, 12_000)]);
    const min = minSegmentMs(p0.zoom.config);
    const p = resizeSegment(p0, "a", "end", 5100, DURATION);
    expect(find(p, "a").endMs).toBe(5000 + min);
  });

  it("stops the end edge at the following neighbour", () => {
    const p = resizeSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 9000, 14_000)]),
      "a",
      "end",
      12_000,
      DURATION,
    );
    expect(find(p, "a").endMs).toBe(9000);
  });

  it("stops the start edge at the preceding neighbour", () => {
    const p = resizeSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 9000, 14_000)]),
      "b",
      "start",
      3000,
      DURATION,
    );
    expect(find(p, "b").startMs).toBe(6000);
  });

  it("clamps the start edge at zero", () => {
    const p = resizeSegment(withSegments([seg("a", 2000, 9000)]), "a", "start", -500, DURATION);
    expect(find(p, "a").startMs).toBe(0);
  });

  it("clamps the end edge at the take length", () => {
    const p = resizeSegment(withSegments([seg("a", 2000, 9000)]), "a", "end", 40_000, DURATION);
    expect(find(p, "a").endMs).toBe(DURATION);
  });

  it("drops a waypoint the start edge is dragged past, keeping the rest in bounds", () => {
    const p0 = withSegments([segWithWaypoints("a", 5000, 12_000, [5300, 8000])]);
    const p = resizeSegment(p0, "a", "start", 6000, DURATION);
    const a = find(p, "a");
    expect(a.startMs).toBe(6000);
    expect(a.waypoints.map((w) => w.tMs)).toEqual([8000]);
    for (const w of a.waypoints) {
      expect(w.tMs).toBeGreaterThanOrEqual(a.startMs);
      expect(w.tMs).toBeLessThanOrEqual(a.endMs);
    }
  });

  it("drops a waypoint the end edge is dragged past, keeping the rest in bounds", () => {
    const p0 = withSegments([segWithWaypoints("a", 2000, 12_000, [4000, 10_000])]);
    const p = resizeSegment(p0, "a", "end", 5000, DURATION);
    const a = find(p, "a");
    expect(a.endMs).toBe(5000);
    expect(a.waypoints.map((w) => w.tMs)).toEqual([4000]);
    for (const w of a.waypoints) {
      expect(w.tMs).toBeGreaterThanOrEqual(a.startMs);
      expect(w.tMs).toBeLessThanOrEqual(a.endMs);
    }
  });

  it("keeps the single nearest waypoint, clamped into bounds, when a resize would strand all of them", () => {
    const p0 = withSegments([segWithWaypoints("a", 2000, 12_000, [3000, 4000])]);
    const p = resizeSegment(p0, "a", "start", 9000, DURATION);
    const a = find(p, "a");
    expect(a.startMs).toBe(9000);
    expect(a.waypoints).toHaveLength(1);
    expect(a.waypoints[0]?.tMs).toBe(9000);
    expect(a.waypoints[0]?.tMs).toBeGreaterThanOrEqual(a.startMs);
    expect(a.waypoints[0]?.tMs).toBeLessThanOrEqual(a.endMs);
  });

  it("leaves the waypoints untouched when the resize crosses none of them", () => {
    const p0 = withSegments([seg("a", 5000, 12_000)]);
    const before = find(p0, "a").waypoints.map((w) => w.tMs);
    const p = resizeSegment(p0, "a", "end", 10_000, DURATION);
    const a = find(p, "a");
    expect(a.endMs).toBe(10_000);
    expect(a.waypoints.map((w) => w.tMs)).toEqual(before);
    expect(a.waypoints).toHaveLength(2);
  });
});

function withSegmentsAndCuts(segments: ZoomSegment[], cuts: Cut[]): Project {
  const base = defaultProject("test-bundle");
  return { ...base, cuts, zoom: { ...base.zoom, segments, keyframes: [] } };
}

/**
 * Spec §7: a drag is measured in OUTPUT ms; each edge maps back through
 * `outputToSource` independently. A segment dragged across a cut therefore
 * changes its SOURCE duration -- the mapped edge's source position jumps by
 * the cut's full length the instant the drag's output target crosses the
 * cut -- while the OUTPUT position of the edge being dragged tracks the
 * pointer exactly. Asserted in both directions: crossing left-to-right and
 * right-to-left across the same cut.
 */
describe("segmentDragToSource", () => {
  const cut: Cut = { id: "cut1", startMs: 8000, endMs: 10_000 };

  it("preserves visible duration when moving a shot that already spans a cut", () => {
    const base = withSegmentsAndCuts([segWithWaypoints("a", 6000, 12_000, [6500, 11_000])], [cut]);
    const p = segmentDragToSource(base, "a", 9000, DURATION);
    const a = find(p, "a");
    expect(sourceSpanToOutput(a.startMs, a.endMs, DURATION, [cut])).toEqual({ startMs: 9000, endMs: 13_000 });
    expect(a.waypoints.map((w) => w.tMs)).toEqual([11_500, 14_000]);
    const back = find(segmentDragToSource(p, "a", 6000, DURATION), "a");
    expect([back.startMs, back.endMs]).toEqual([6000, 12_000]);
    expect(back.waypoints.map((w) => w.tMs)).toEqual([6500, 11_000]);
  });

  it("maps both edges when an uncut shot moves onto a cut", () => {
    const p = segmentDragToSource(withSegmentsAndCuts([seg("a", 2000, 6000)], [cut]), "a", 6000, DURATION);
    const a = find(p, "a");
    expect([a.startMs, a.endMs]).toEqual([6000, 12_000]);
    expect(sourceSpanToOutput(a.startMs, a.endMs, DURATION, [cut])).toEqual({ startMs: 6000, endMs: 10_000 });
    expect(find(segmentDragToSource(p, "a", 6000, DURATION), "a")).toEqual(a);
  });

  it("clamps in output time without overlapping a neighbour at a cut seam", () => {
    const p = segmentDragToSource(withSegmentsAndCuts([seg("a", 1000, 5000), seg("b", 8500, 14_000)], [cut]), "a", 20_000, DURATION);
    const a = find(p, "a");
    expect(a.endMs).toBe(8000);
    expect(sourceSpanToOutput(a.startMs, a.endMs, DURATION, [cut])).toEqual({ startMs: 4000, endMs: 8000 });
  });

  it("keeps collapsed waypoints unique and inside the moved shot", () => {
    const p = segmentDragToSource(withSegmentsAndCuts([segWithWaypoints("a", 6000, 12_000, [6500, 8500, 9500, 11_000])], [cut]), "a", 9000, DURATION);
    expect(find(p, "a").waypoints.map((w) => w.tMs)).toEqual([11_500, 13_000, 14_000]);
  });

  it("leaves an end edge before its cut when dragged to the same output position", () => {
    const base = withSegmentsAndCuts([seg("a", 4000, 8000)], [cut]);
    const a = find(segmentDragToSource(base, "a", 4000, DURATION), "a");
    expect([a.startMs, a.endMs]).toEqual([4000, 8000]);
    expect(a.waypoints).toEqual(find(base, "a").waypoints);
  });

  it("does not try to move a shot entirely removed by a cut", () => {
    const base = withSegmentsAndCuts([seg("a", 8000, 10_000)], [cut]);
    expect(find(segmentDragToSource(base, "a", 9000, DURATION), "a")).toEqual(find(base, "a"));
  });

  it("moves a segment across a cut to the exact output target, preserving its output duration", () => {
    const p = segmentDragToSource(
      withSegmentsAndCuts([seg("a", 2000, 5000)], [cut]),
      "a",
      9000,
      DURATION,
    );
    const a = find(p, "a");
    // The source position jumps by the cut's full 2000ms the instant the
    // drag's output target (9000) crosses the cut's output threshold (8000)
    // -- spec §7's "off-by-one trap".
    expect(a.startMs).toBe(11_000);
    expect(a.endMs).toBe(14_000);
    // Mapping the result back through the forward direction recovers
    // exactly the output target dragged to, at the pre-drag output length.
    expect(sourceSpanToOutput(a.startMs, a.endMs, DURATION, [cut])).toEqual({
      startMs: 9000,
      endMs: 12_000,
    });
  });

  it("moves a segment back across the same cut, recovering the exact output target", () => {
    const p = segmentDragToSource(
      withSegmentsAndCuts([seg("a", 11_000, 14_000)], [cut]),
      "a",
      2000,
      DURATION,
    );
    const a = find(p, "a");
    // Below the cut's output threshold, outputToSource is the identity --
    // no jump -- which is the other side of the same boundary above.
    expect(a.startMs).toBe(2000);
    expect(a.endMs).toBe(5000);
    expect(sourceSpanToOutput(a.startMs, a.endMs, DURATION, [cut])).toEqual({
      startMs: 2000,
      endMs: 5000,
    });
  });

  it("returns the project unchanged for an unknown id", () => {
    const p0 = withSegmentsAndCuts([seg("a", 2000, 5000)], [cut]);
    expect(segmentDragToSource(p0, "nope", 9000, DURATION)).toBe(p0);
  });
});

describe("segmentResizeToSource", () => {
  const cut: Cut = { id: "cut1", startMs: 8000, endMs: 10_000 };

  it("resizes the start edge across a cut without touching the end edge's source position", () => {
    const before = withSegmentsAndCuts([seg("b", 11_000, 16_000)], [cut]);
    const p = segmentResizeToSource(before, "b", "start", 7000, DURATION);
    const b = find(p, "b");
    expect(b.startMs).toBe(7000);
    // Independence: an end resize is a separate call, so the end edge's
    // source position is exactly what it was before this resize.
    expect(b.endMs).toBe(find(before, "b").endMs);
    expect(sourceToOutput(b.startMs, DURATION, [cut])).toBe(7000);
  });

  it("resizes the end edge across a cut without touching the start edge's source position", () => {
    const before = withSegmentsAndCuts([seg("c", 2000, 7000)], [cut]);
    const p = segmentResizeToSource(before, "c", "end", 12_000, DURATION);
    const c = find(p, "c");
    expect(c.startMs).toBe(find(before, "c").startMs);
    expect(c.endMs).toBe(14_000);
    expect(sourceToOutput(c.endMs, DURATION, [cut])).toBe(12_000);
  });
});

describe("setSegmentDepth", () => {
  it("writes the depth to every waypoint and pins", () => {
    const p = setSegmentDepth(withSegments([seg("a", 2000, 6000)]), "a", 0.85);
    expect(find(p, "a").waypoints.map((w) => w.depth)).toEqual([0.85, 0.85]);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("clamps to 0..1", () => {
    const p = setSegmentDepth(withSegments([seg("a", 2000, 6000)]), "a", 4);
    expect(find(p, "a").waypoints.every((w) => w.depth === 1)).toBe(true);
  });
});

describe("setSegmentCamera", () => {
  it("switches the camera WITHOUT pinning", () => {
    const p = setSegmentCamera(withSegments([seg("a", 2000, 6000)]), "a", "follow");
    expect(find(p, "a").position).toBe("follow");
    expect(find(p, "a").pinned).toBe(false);
  });
});

describe("deleteSegment", () => {
  it("removes it", () => {
    const p = deleteSegment(withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]), "a");
    expect(p.zoom.segments.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resetSegment", () => {
  it("unpins so the planner reclaims it", () => {
    const pinned = withSegments([{ ...seg("a", 2000, 6000), pinned: true }]);
    expect(find(resetSegment(pinned, "a"), "a").pinned).toBe(false);
  });
});

function withCuts(cuts: Cut[]): Project {
  return { ...defaultProject("test-bundle"), cuts };
}

describe("addCut", () => {
  it("appends a cut with the id it was given", () => {
    const p = addCut(withCuts([]), "c1", 2000, 3000, DURATION);
    expect(p.cuts).toEqual([{ id: "c1", startMs: 2000, endMs: 3000 }]);
  });

  it("merges into an overlapping cut", () => {
    const p = addCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "c1", 3000, 5000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 2000, endMs: 5000 }]);
  });

  it("ignores a zero-length cut", () => {
    const p = withCuts([]);
    expect(addCut(p, "c1", 2000, 2000, DURATION).cuts).toEqual([]);
  });
});

describe("moveCut", () => {
  it("shifts both edges", () => {
    const p = moveCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", 1000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 3000, endMs: 5000 }]);
  });

  it("clamps at zero without shrinking", () => {
    const p = moveCut(withCuts([{ id: "a", startMs: 1000, endMs: 3000 }]), "a", -5000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 0, endMs: 2000 }]);
  });

  it("keeps the moved cut's id when it merges into another", () => {
    const p = moveCut(
      withCuts([
        { id: "a", startMs: 2000, endMs: 4000 },
        { id: "b", startMs: 8000, endMs: 10_000 },
      ]),
      "b",
      -5000,
      DURATION,
    );
    expect(p.cuts).toEqual([{ id: "b", startMs: 2000, endMs: 5000 }]);
  });
});

describe("resizeCut", () => {
  it("moves the end edge", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 6000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 2000, endMs: 6000 }]);
  });

  it("stops the end edge at the minimum cut length", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 2010, DURATION);
    expect(p.cuts[0]?.endMs).toBe(2000 + MIN_CUT_MS);
  });

  it("stops the start edge at the minimum cut length", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "start", 3990, DURATION);
    expect(p.cuts[0]?.startMs).toBe(4000 - MIN_CUT_MS);
  });
});

describe("deleteCut", () => {
  it("removes it", () => {
    const p = deleteCut(
      withCuts([
        { id: "a", startMs: 2000, endMs: 4000 },
        { id: "b", startMs: 8000, endMs: 10_000 },
      ]),
      "a",
    );
    expect(p.cuts.map((c) => c.id)).toEqual(["b"]);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]);
    expect(deleteCut(p, "nope")).toBe(p);
  });
});

/**
 * Where the cut lane draws a cut, as fractions across the lane.
 *
 * This is the geometry task 10's acceptance property is about: the region's
 * left edge is the cut's seam and its right edge is the seam plus the removed
 * material, both drawn at the lane's CURRENT output scale -- a scale that
 * every resize changes. Mirrors `CutLane`'s layout exactly, including passing
 * only the *other* cuts to `sourceSpanToOutput`.
 */
function drawnFracs(p: Project, id: string): { left: number; right: number } {
  const span = cutLaneSpan(p.cuts, id, DURATION);
  if (span === null) throw new Error("missing cut span");
  const laneMs = outputDurationMs(DURATION, p.cuts);
  return { left: span.startMs / laneMs, right: span.endMs / laneMs };
}

describe("cutDragToSource", () => {
  it("puts the seam under the pointer", () => {
    // A move keeps the cut's length, so the lane's scale holds still: 30s of
    // take less a 2s cut is a 28s lane, and half of it is 14s.
    const p = cutDragToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", 0.5, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 14_000, endMs: 16_000 }]);
    expect(drawnFracs(p, "a").left).toBeCloseTo(0.5, 10);
  });

  it("maps the target through the OTHER cuts' ripple", () => {
    const p = cutDragToSource(
      withCuts([
        { id: "b", startMs: 1000, endMs: 3000 },
        { id: "a", startMs: 10_000, endMs: 12_000 },
      ]),
      "a",
      0.5,
      DURATION,
    );
    // Lane is 26s; half of it is output 13s, which is source 15s once b's 2s
    // is added back.
    expect(p.cuts).toEqual([
      { id: "b", startMs: 1000, endMs: 3000 },
      { id: "a", startMs: 15_000, endMs: 17_000 },
    ]);
    expect(drawnFracs(p, "a").left).toBeCloseTo(0.5, 10);
  });

  it("is idempotent: re-applying the same target changes nothing", () => {
    const once = cutDragToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", 0.5, DURATION);
    expect(cutDragToSource(once, "a", 0.5, DURATION).cuts).toEqual(once.cuts);
  });

  it("does not bank a clamped step", () => {
    // Held against zero, then dragged back: the second step is measured fresh
    // from the clamped position toward the same absolute target, so it lands
    // exactly where an unclamped drag to 0.5 would have.
    const held = cutDragToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", -0.4, DURATION);
    expect(held.cuts).toEqual([{ id: "a", startMs: 0, endMs: 2000 }]);
    expect(cutDragToSource(held, "a", 0.5, DURATION).cuts).toEqual([
      { id: "a", startMs: 14_000, endMs: 16_000 },
    ]);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]);
    expect(cutDragToSource(p, "nope", 0.5, DURATION)).toBe(p);
  });
});

/**
 * The property ruling 1 asks for: the dragged edge lands under the cursor,
 * for the whole gesture, at any cut length.
 *
 * Growing a cut shortens the output the lane is drawn against, so a resize
 * rescales the lane it is being measured in. `cutResizeToSource` therefore
 * solves for the geometry that holds AFTER that rescale rather than
 * converting the pointer through the pre-edit scale, which is why every
 * assertion below reads the edge back out of `drawnFracs` -- the post-edit
 * drawing -- and expects the fraction that was dragged to.
 */
describe("cutResizeToSource", () => {
  it("keeps the end edge under the cursor", () => {
    const p = cutResizeToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 0.8, DURATION);
    expect(drawnFracs(p, "a").right).toBeCloseTo(0.8, 10);
    // The start edge did not move in source, so the cut still begins at 2s --
    // its drawn seam slides right only because the lane got shorter.
    expect(p.cuts[0]?.startMs).toBe(2000);
  });

  it("keeps the end edge under the cursor when the cut is a large fraction of the take", () => {
    // The far right of the lane. The cut ends up 14s of a 30s take, and the
    // lane is 16s, so this is the case where the pre-edit scale would be most
    // wrong.
    const p = cutResizeToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 1, DURATION);
    expect(drawnFracs(p, "a").right).toBeCloseTo(1, 10);
    expect(p.cuts[0]).toEqual({ id: "a", startMs: 2000, endMs: 16_000 });
  });

  it("keeps the start edge under the cursor", () => {
    const p = cutResizeToSource(withCuts([{ id: "a", startMs: 10_000, endMs: 12_000 }]), "a", "start", 0.2, DURATION);
    expect(drawnFracs(p, "a").left).toBeCloseTo(0.2, 10);
    expect(p.cuts[0]).toEqual({ id: "a", startMs: 4500, endMs: 12_000 });
  });

  it("keeps the start edge under the cursor across another cut's ripple", () => {
    const p = cutResizeToSource(
      withCuts([
        { id: "b", startMs: 1000, endMs: 3000 },
        { id: "a", startMs: 10_000, endMs: 12_000 },
      ]),
      "a",
      "start",
      0.1,
      DURATION,
    );
    expect(drawnFracs(p, "a").left).toBeCloseTo(0.1, 10);
    expect(p.cuts).toEqual([
      { id: "b", startMs: 1000, endMs: 3000 },
      { id: "a", startMs: 4000, endMs: 12_000 },
    ]);
  });

  it("is idempotent: re-applying the same target changes nothing", () => {
    const once = cutResizeToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 0.8, DURATION);
    expect(cutResizeToSource(once, "a", "end", 0.8, DURATION).cuts).toEqual(once.cuts);
  });

  it("does not bank a step clamped at the minimum cut length", () => {
    const held = cutResizeToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 0.05, DURATION);
    expect(held.cuts[0]?.endMs).toBe(2000 + MIN_CUT_MS);
    // Dragging back out lands exactly where a fresh drag to 0.8 lands: the
    // rejected movement was not accumulated anywhere.
    const back = cutResizeToSource(held, "a", "end", 0.8, DURATION);
    const fresh = cutResizeToSource(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 0.8, DURATION);
    expect(back.cuts).toEqual(fresh.cuts);
  });

  it("clamps a start edge dragged off the right end to the minimum cut length", () => {
    // f = 1 has no finite solution (the lane would have to be zero-length);
    // it means "as far right as this goes", and resizeCut's floor takes over.
    const p = cutResizeToSource(withCuts([{ id: "a", startMs: 10_000, endMs: 12_000 }]), "a", "start", 1, DURATION);
    expect(p.cuts[0]?.startMs).toBe(12_000 - MIN_CUT_MS);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]);
    expect(cutResizeToSource(p, "nope", "end", 0.5, DURATION)).toBe(p);
  });
});

describe("createCutFromDrag", () => {
  it("cuts the output range the drag covered", () => {
    const p = createCutFromDrag(withCuts([]), "c1", 0.1, 0.3, DURATION);
    expect(p.cuts).toEqual([{ id: "c1", startMs: 3000, endMs: 9000 }]);
  });

  it("takes the two edges in either order", () => {
    expect(createCutFromDrag(withCuts([]), "c1", 0.3, 0.1, DURATION).cuts).toEqual(
      createCutFromDrag(withCuts([]), "c1", 0.1, 0.3, DURATION).cuts,
    );
  });

  it("maps both edges through the existing cuts' ripple", () => {
    // A 28s lane after b's 2s cut: output 7s and 14s are source 9s and 16s.
    const p = createCutFromDrag(withCuts([{ id: "b", startMs: 1000, endMs: 3000 }]), "c1", 0.25, 0.5, DURATION);
    expect(p.cuts).toEqual([
      { id: "b", startMs: 1000, endMs: 3000 },
      { id: "c1", startMs: 9000, endMs: 16_000 },
    ]);
  });

  it("creates nothing below MIN_CUT_MS -- the floor addCut does not enforce", () => {
    // 0.003 of a 30s lane is 90ms. `addCut` would happily author it: only
    // normalizeCuts' zero-length filter stands behind this check.
    const p = withCuts([]);
    expect(createCutFromDrag(p, "c1", 0.2, 0.203, DURATION)).toBe(p);
    expect(addCut(p, "c1", 6000, 6090, DURATION).cuts).toHaveLength(1);
  });

  it("creates nothing for a click, where both edges are the same", () => {
    const p = withCuts([]);
    expect(createCutFromDrag(p, "c1", 0.4, 0.4, DURATION)).toBe(p);
  });

  it("clamps a drag that left the lane to the lane's ends", () => {
    const p = createCutFromDrag(withCuts([]), "c1", -0.5, 1.5, DURATION);
    expect(p.cuts).toEqual([{ id: "c1", startMs: 0, endMs: DURATION }]);
  });
});

describe("manual timeline segment", () => {
  it("finds a surviving gap past shots and cuts", () => {
    const p = defaultProject("test");
    p.zoom.segments = [seg("existing", 0, 4000)];
    p.cuts = [{id: "removed", startMs: 4000, endMs: 6500}];
    const next = addSegment(p, 1000, DURATION, "manual");
    const added = next.zoom.segments.find(s => s.id === "manual")!;
    expect(added.startMs).toBe(6500);
    expect(added.endMs).toBe(9500);
    expect(added.pinned).toBe(true);
    expect(p.zoom.segments).toHaveLength(1);
  });
  it("does not create a shot when insufficient surviving time remains", () => {
    const p = defaultProject("test");
    expect(addSegment(p, DURATION - 50, DURATION, "manual")).toBe(p);
  });
});
