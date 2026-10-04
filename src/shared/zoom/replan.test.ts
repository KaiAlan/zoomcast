import { describe, expect, it } from "vitest";
import { replan, replanSegments } from "./replan";
import type { ZoomKeyframe, ZoomSegment } from "./types";

const kf = (over: Partial<ZoomKeyframe> & { id: string }): ZoomKeyframe => ({
  tSourceMs: 1000,
  scale: 1.5,
  cx: 0.5,
  cy: 0.5,
  easing: "zoomEase",
  transitionMs: 600,
  origin: "auto",
  pinned: false,
  ...over,
});

describe("replan", () => {
  it("replaces unpinned auto keyframes wholesale", () => {
    const out = replan([kf({ id: "k1i", scale: 1.5 })], [kf({ id: "k1i", scale: 1.9 })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.scale).toBe(1.9);
  });

  it("keeps a pinned keyframe and drops the generated one with the same id", () => {
    const out = replan(
      [kf({ id: "k1i", scale: 1.2, pinned: true })],
      [kf({ id: "k1i", scale: 1.9 })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.scale).toBe(1.2);
    expect(out[0]?.pinned).toBe(true);
  });

  it("keeps manual keyframes even when unpinned", () => {
    const out = replan([kf({ id: "m1", origin: "manual" })], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("m1");
  });

  it("adds newly generated keyframes alongside pinned ones", () => {
    const out = replan(
      [kf({ id: "k1i", pinned: true })],
      [kf({ id: "k1i" }), kf({ id: "k2i", tSourceMs: 4000 })],
    );
    expect(out.map((k) => k.id)).toEqual(["k1i", "k2i"]);
  });

  it("returns keyframes in time order", () => {
    const out = replan(
      [kf({ id: "p", tSourceMs: 5000, pinned: true })],
      [kf({ id: "g", tSourceMs: 100 })],
    );
    expect(out.map((k) => k.tSourceMs)).toEqual([100, 5000]);
  });

  it("drops an unpinned auto keyframe the new plan no longer generates", () => {
    const out = replan([kf({ id: "stale" })], []);
    expect(out).toEqual([]);
  });
});

describe("replanSegments", () => {
  const seg = (over: Partial<ZoomSegment> = {}): ZoomSegment => ({
    id: "s1",
    startMs: 1000,
    endMs: 3000,
    position: "fixed",
    waypoints: [{ id: "k0", tMs: 1000, depth: 1, cx: 0.5, cy: 0.5 }],
    origin: "auto",
    pinned: false,
    ...over,
  });

  it("regenerates everything the user has not touched", () => {
    const generated = [seg({ id: "g1" }), seg({ id: "g2", startMs: 5000, endMs: 7000 })];
    expect(replanSegments([seg({ id: "old" })], generated)).toEqual(generated);
  });

  it("keeps a pinned segment and drops what would compete with it", () => {
    const kept = seg({ id: "mine", pinned: true, position: "follow" });
    const out = replanSegments([kept], [seg({ id: "g1", startMs: 2000, endMs: 4000 })]);

    expect(out).toEqual([kept]);
  });

  it("keeps a manual segment", () => {
    const kept = seg({ id: "mine", origin: "manual" });
    expect(replanSegments([kept], [])).toEqual([kept]);
  });

  it("keeps a generated segment that merely abuts a kept one", () => {
    // Touching is not overlapping: a segment starting exactly where another
    // ends is the travelling case, not a competing one.
    const kept = seg({ id: "mine", pinned: true });
    const after = seg({ id: "g1", startMs: 3000, endMs: 5000 });

    expect(replanSegments([kept], [after]).map((s) => s.id)).toEqual(["mine", "g1"]);
  });

  it("carries a camera override across a re-plan, keyed by id", () => {
    const switched = seg({ id: "s1", position: "follow" });
    const out = replanSegments([switched], [seg({ id: "s1", position: "fixed" })]);

    expect(out).toHaveLength(1);
    expect(out[0]?.position).toBe("follow");
  });

  it("does not pin the overridden segment — its times still re-plan", () => {
    const switched = seg({ id: "s1", startMs: 1000, endMs: 3000, position: "follow" });
    const retimed = seg({ id: "s1", startMs: 1800, endMs: 4200, position: "fixed" });
    const out = replanSegments([switched], [retimed]);

    expect(out[0]).toEqual({ ...retimed, position: "follow" });
    expect(out[0]?.pinned).toBe(false);
  });

  it("drops an override whose cluster the new plan no longer produces", () => {
    const switched = seg({ id: "s1", position: "follow" });
    const elsewhere = seg({ id: "s9", startMs: 5000, endMs: 7000 });
    const out = replanSegments([switched], [elsewhere]);

    expect(out).toEqual([elsewhere]);
  });

  it("upgrades the legacy automatic fixed mode to generated follow", () => {
    expect(replanSegments([seg()], [seg({ position: "follow" })])[0]?.position).toBe("follow");
  });

  it("keeps an explicitly selected fixed mode without freezing its timing", () => {
    const existing = seg({ cameraOverride: true });
    const generated = seg({ position: "follow", startMs: 1800, endMs: 4800 });
    expect(replanSegments([existing], [generated])).toEqual([
      { ...generated, position: "fixed", cameraOverride: true },
    ]);
  });

  it("returns segments in time order", () => {
    const kept = seg({ id: "mine", startMs: 8000, endMs: 9000, pinned: true });
    const out = replanSegments([kept], [seg({ id: "g1" })]);

    expect(out.map((s) => s.startMs)).toEqual([1000, 8000]);
  });
});
