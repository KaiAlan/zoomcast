import { describe, expect, it } from "vitest";
import { deriveKeyframes, replanFrom, type DeriveContext } from "./derive";
import { defaultProject } from "../project/defaults";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import type { Project } from "../project/types";
import type { ZoomSegment } from "./types";

const ctx: DeriveContext = {
  telemetry: [],
  cameraPath: null,
  source: { w: 1920, h: 1080 },
  durationMs: 10_000,
};

function projectWith(segments: ZoomSegment[]): Project {
  const base = defaultProject("test-bundle");
  return { ...base, zoom: { ...base.zoom, segments, keyframes: [] } };
}

const segment: ZoomSegment = {
  id: "s1",
  startMs: 2000,
  endMs: 6000,
  position: "fixed",
  waypoints: [{ id: "w1", tMs: 2500, depth: 0.5, cx: 0.5, cy: 0.5 }],
  origin: "auto",
  pinned: true,
};

describe("deriveKeyframes", () => {
  it("returns the segments it was given, untouched", () => {
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.segments).toEqual([segment]);
  });

  it("rebuilds keyframes from those segments", () => {
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.keyframes.length).toBeGreaterThan(0);
    expect(out.keyframes.every((k) => k.tSourceMs >= 0)).toBe(true);
  });

  it("does not consult telemetry", () => {
    const noReadContext = { ...ctx, get telemetry(): never { throw new Error("telemetry must not be read"); } };
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), noReadContext);
    expect(out.keyframes.length).toBeGreaterThan(0);
  });
});

describe("replanFrom", () => {
  it("drops an unpinned auto segment when telemetry is empty", () => {
    const auto: ZoomSegment = { ...segment, pinned: false, origin: "auto" };
    const out = replanFrom(DEFAULT_ZOOM_CONFIG, projectWith([auto]), ctx);
    expect(out.segments).toEqual([]);
  });

  it("keeps a pinned segment when telemetry is empty", () => {
    const out = replanFrom(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.segments.map((s) => s.id)).toEqual(["s1"]);
  });
});
