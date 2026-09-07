import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { fitScale, pixelParityZoom, screenRect } from "./geometry";
import type { Cluster, PlanContext } from "./types";

const HD = { w: 1920, h: 1080 };
const UHD = { w: 3840, h: 2160 };

describe("screenRect", () => {
  it("insets by the padding factor and centres", () => {
    const r = screenRect(HD, HD, 0.85);
    expect(r.w).toBeCloseTo(1632, 5);
    expect(r.h).toBeCloseTo(918, 5);
    expect(r.x).toBeCloseTo(144, 5);
    expect(r.y).toBeCloseTo(81, 5);
  });

  it("fits by height when the source is wider than the output", () => {
    const r = screenRect({ w: 3840, h: 1080 }, HD, 1);
    expect(r.w).toBeCloseTo(1920, 5);
    expect(r.h).toBeCloseTo(540, 5);
  });
});

describe("pixelParityZoom", () => {
  it("gives ~1.18x of free zoom on a 1080p source", () => {
    expect(pixelParityZoom(HD, HD, 0.85)).toBeCloseTo(1.176, 3);
  });

  it("doubles when the source is 4K", () => {
    expect(pixelParityZoom(UHD, HD, 0.85)).toBeCloseTo(2.353, 3);
  });

  it("is exactly 1 with no padding on a matched source", () => {
    expect(pixelParityZoom(HD, HD, 1)).toBeCloseTo(1, 6);
  });
});

describe("fitScale", () => {
  const ctx: PlanContext = {
    source: HD,
    output: HD,
    paddingFactor: 0.85,
    durationMs: 60_000,
  };

  const cluster = (halfW: number): Cluster => ({
    startT: 0,
    endT: 0,
    cx: 960,
    cy: 540,
    weight: 1,
    anchorIndex: 0,
    minX: 960 - halfW,
    maxX: 960 + halfW,
    minY: 490,
    maxY: 590,
  });

  it("clamps a tight cluster to the configured maximum", () => {
    // A 5px cluster asks for roughly 12x. The cap is cfg.maxZoom since
    // 2026-09-07 — it used to be pixelParityZoom, which meant every zoom on
    // every take landed on 1.176 and the camera had nowhere to go.
    expect(fitScale(cluster(5), DEFAULT_ZOOM_CONFIG, ctx)).toBeCloseTo(
      DEFAULT_ZOOM_CONFIG.maxZoom,
      9,
    );
  });

  it("follows the configured maximum rather than the output size", () => {
    const shallow = { ...DEFAULT_ZOOM_CONFIG, maxZoom: 1.2 };
    expect(fitScale(cluster(5), shallow, ctx)).toBeCloseTo(1.2, 9);
  });

  it("never returns less than 1", () => {
    expect(fitScale(cluster(5000), DEFAULT_ZOOM_CONFIG, ctx)).toBe(1);
  });
});
