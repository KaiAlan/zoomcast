import { describe, expect, it } from "vitest";
import { clamp, screenRect } from "./geometry";
import { WHOLE_SOURCE, sourceToFrame, type SourceRect } from "./viewport";
import type { Size } from "./types";

const SOURCE: Size = { w: 1920, h: 1080 };
const PAD = 0.85;
const frameFor = (output: Size) => screenRect(SOURCE, output, PAD);

/**
 * A sub-region of the source, purely to exercise the mapping. Product code
 * always passes WHOLE_SOURCE now — the zoom lives in the quad — but
 * `sourceToFrame` is a general function and its contract is worth holding for
 * any region.
 */
const at = (scale: number, cx = 0.5, cy = 0.5): SourceRect => {
  const w = Math.min(1, 1 / Math.max(1, scale));
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - w / 2, 0, 1 - w), w, h: w };
};

/*
 * `sourceRectFor` is gone: the window grows and travels again rather than the
 * sampled region shrinking, so the camera and its clamp live in
 * `screenQuadFor`, guarded by the continuity sweeps in
 * src/renderer/gl/layout.test.ts. What remains here is the ONE mapping.
 */

describe("sourceToFrame (invariants 5 and 6)", () => {
  const frame = frameFor(SOURCE);

  it("maps the centre of the region to the centre of the frame", () => {
    const rect = at(1.6, 0.3, 0.7);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };

    expect(sourceToFrame(p, rect, frame)).toEqual({
      x: frame.x + frame.w / 2,
      y: frame.y + frame.h / 2,
    });
  });

  it("maps the whole source across the whole frame", () => {
    const rect = WHOLE_SOURCE;
    expect(sourceToFrame({ x: 0, y: 0 }, rect, frame)).toEqual({ x: frame.x, y: frame.y });
    expect(sourceToFrame({ x: 1, y: 1 }, rect, frame)).toEqual({
      x: frame.x + frame.w,
      y: frame.y + frame.h,
    });
  });

  /** Invariant 6: an overlay outside the sampled region is not rendered. */
  it("rejects a point outside the sampled region", () => {
    const rect = at(2, 0.5, 0.5); // samples the middle half
    expect(sourceToFrame({ x: 0.05, y: 0.5 }, rect, frame)).toBeNull();
    expect(sourceToFrame({ x: 0.5, y: 0.95 }, rect, frame)).toBeNull();
  });

  it("keeps top-left orientation (invariant 10)", () => {
    // A point in the source's TOP half must land in the frame's TOP half.
    const mapped = sourceToFrame({ x: 0.5, y: 0.25 }, WHOLE_SOURCE, frame);
    expect(mapped?.y).toBeLessThan(frame.y + frame.h / 2);
  });
});
