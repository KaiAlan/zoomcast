import { describe, expect, it } from "vitest";
import type { AspectChoice, OutputConfig } from "../project/types";
import { ASPECT_RATIOS, outputSizeFor } from "./aspect";

const src = { w: 1920, h: 1080 };
const out = (over: Partial<OutputConfig> = {}): OutputConfig => ({
  width: 1920,
  height: 1080,
  aspect: "native",
  fps: 60,
  bitrateMbps: 12,
  ...over,
});

const ALL: AspectChoice[] = ["native", "16:9", "4:3", "1:1", "9:16"];

describe("outputSizeFor", () => {
  it("honours the explicit resolution under native", () => {
    expect(outputSizeFor(out(), src)).toEqual({ w: 1920, h: 1080 });
    expect(outputSizeFor(out({ width: 3840, height: 2160 }), src)).toEqual({ w: 3840, h: 2160 });
  });

  it("keeps the configured height and derives the width", () => {
    // Switching aspect should change the frame's SHAPE, not how much detail is
    // in it, so the height is the invariant.
    expect(outputSizeFor(out({ aspect: "1:1" }), src)).toEqual({ w: 1080, h: 1080 });
    expect(outputSizeFor(out({ aspect: "4:3" }), src)).toEqual({ w: 1440, h: 1080 });
    expect(outputSizeFor(out({ aspect: "16:9" }), src)).toEqual({ w: 1920, h: 1080 });
  });

  it("handles a portrait target from a landscape source", () => {
    // 1080 * 9/16 = 607.5, which must round to an even 608, not 607.
    expect(outputSizeFor(out({ aspect: "9:16" }), src)).toEqual({ w: 608, h: 1080 });
  });

  it("always returns even dimensions, because H.264 requires them", () => {
    // An odd dimension fails the encoder outright, so this holds for every
    // combination rather than for the tidy ones.
    for (const aspect of ALL) {
      for (const [w, h] of [[1279, 721], [3, 3], [1921, 1081]]) {
        const r = outputSizeFor(out({ aspect, width: w, height: h }), src);
        expect(r.w % 2, `${aspect} ${w}x${h}`).toBe(0);
        expect(r.h % 2, `${aspect} ${w}x${h}`).toBe(0);
      }
    }
  });

  it("never returns a zero or negative dimension", () => {
    for (const aspect of ALL) {
      const r = outputSizeFor(out({ aspect, width: 0, height: 0 }), src);
      expect(r.w, aspect).toBeGreaterThan(0);
      expect(r.h, aspect).toBeGreaterThan(0);
    }
  });

  it("gives every named aspect the ratio it claims, within rounding", () => {
    for (const [name, ratio] of Object.entries(ASPECT_RATIOS)) {
      const r = outputSizeFor(out({ aspect: name as AspectChoice, height: 1080 }), src);
      // Within one pixel of the ideal, which is all evenness allows.
      expect(Math.abs(r.w / r.h - ratio), name).toBeLessThan(0.01);
    }
  });
});
