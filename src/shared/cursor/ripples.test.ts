import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { ripplesAt } from "./ripples";

const clicks: TelemetryEvent[] = [
  { t: 1000, k: "down", x: 100, y: 200, b: 1 },
  { t: 5000, k: "down", x: 400, y: 300, b: 1 },
];

describe("ripplesAt", () => {
  it("shows nothing before the first click", () => {
    expect(ripplesAt(clicks, 500, 400)).toEqual([]);
  });

  it("starts a ripple at the click", () => {
    const [r] = ripplesAt(clicks, 1000, 400);
    expect(r).toMatchObject({ x: 100, y: 200 });
    expect(r?.progress).toBeCloseTo(0, 5);
  });

  it("advances the ripple over its duration", () => {
    expect(ripplesAt(clicks, 1200, 400)[0]?.progress).toBeCloseTo(0.5, 5);
  });

  it("drops the ripple once it completes", () => {
    expect(ripplesAt(clicks, 1500, 400)).toEqual([]);
  });

  it("drops the ripple exactly at the duration boundary (age === durationMs)", () => {
    expect(ripplesAt(clicks, 1400, 400)).toEqual([]);
  });

  it("ignores clicks in the future", () => {
    expect(ripplesAt(clicks, 1200, 400)).toHaveLength(1);
  });

  it("carries two ripples at once when clicks land close together", () => {
    const rapid: TelemetryEvent[] = [
      { t: 1000, k: "down", x: 100, y: 200, b: 1 },
      { t: 1100, k: "down", x: 150, y: 250, b: 1 },
    ];

    const result = ripplesAt(rapid, 1150, 400);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ x: 100, y: 200 });
    expect(result[0]?.progress).toBeCloseTo(0.375, 5);
    expect(result[1]).toMatchObject({ x: 150, y: 250 });
    expect(result[1]?.progress).toBeCloseTo(0.125, 5);
  });
});
