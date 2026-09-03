import { describe, expect, it } from "vitest";
import { replan } from "./replan";
import type { ZoomKeyframe } from "./types";

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
