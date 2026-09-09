import { describe, expect, it } from "vitest";
import {
  deleteSegment,
  minSegmentMs,
  moveSegment,
  resetSegment,
  resizeSegment,
  setSegmentCamera,
  setSegmentDepth,
} from "./edits";
import { defaultProject } from "./defaults";
import type { Project } from "./types";
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
