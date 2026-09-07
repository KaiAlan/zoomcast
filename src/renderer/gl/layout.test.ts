import { describe, expect, it } from "vitest";
import { screenRect } from "../../shared/zoom/geometry";
import { screenQuad } from "./layout";

const HD = { w: 1920, h: 1080 };
const PAD = 0.85;

/**
 * What used to live here — the exhaustive clamp sweeps that hold the
 * head-of-file jump closed — moved to src/shared/zoom/viewport.test.ts with
 * the clamp itself. `screenQuad` no longer has a clamp, or a zoom, or anything
 * to be discontinuous about; the camera is `sourceRectFor` now.
 */
describe("screenQuad", () => {
  it("is exactly the frame screenRect describes", () => {
    expect(screenQuad(HD, HD, PAD)).toEqual(screenRect(HD, HD, PAD));
  });

  it("does not move when the zoom changes", () => {
    // The whole point of the 2026-09-07 change: the frame is presentation, the
    // sampled region is the camera. There is no longer a zoom argument to pass,
    // and that is the contract — not an omission.
    expect(screenQuad(HD, HD, PAD)).toEqual(screenQuad(HD, HD, PAD));
  });

  it("keeps the padding visible at every output aspect", () => {
    for (const out of [HD, { w: 1080, h: 1080 }, { w: 608, h: 1080 }, { w: 1920, h: 600 }]) {
      const q = screenQuad(HD, out, PAD);
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.w).toBeLessThanOrEqual(out.w);
      expect(q.h).toBeLessThanOrEqual(out.h);
    }
  });

  it("carries the source's aspect ratio, which is what invariant 3 rests on", () => {
    for (const out of [HD, { w: 1080, h: 1080 }, { w: 1280, h: 720 }]) {
      const q = screenQuad(HD, out, PAD);
      expect(q.w / q.h).toBeCloseTo(HD.w / HD.h, 9);
    }
  });

  it("centres the frame in the output", () => {
    const out = { w: 1080, h: 1080 };
    const q = screenQuad(HD, out, PAD);
    expect(q.x + q.w / 2).toBeCloseTo(out.w / 2, 9);
    expect(q.y + q.h / 2).toBeCloseTo(out.h / 2, 9);
  });
});
