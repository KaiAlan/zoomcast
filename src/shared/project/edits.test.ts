import { describe, expect, it } from "vitest";
import {
  addCut,
  deleteCut,
  deleteSegment,
  minSegmentMs,
  MIN_CUT_MS,
  moveCut,
  moveSegment,
  resetSegment,
  resizeCut,
  resizeSegment,
  setSegmentCamera,
  setSegmentDepth,
} from "./edits";
import { defaultProject } from "./defaults";
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
    expect(minSegmentMs(cfg)).toBe(cfg.zoomInOverlapMs + cfg.transitionOutMs);
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
