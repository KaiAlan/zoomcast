import { describe, expect, it } from "vitest";
import { screenRect } from "../../shared/zoom/geometry";
import { NO_ZOOM } from "../../shared/zoom/interpolate";
import { screenQuad } from "./layout";

const HD = { w: 1920, h: 1080 };
const PAD = 0.85;

describe("screenQuad", () => {
  it("reduces exactly to screenRect at scale 1", () => {
    expect(screenQuad(HD, HD, PAD, NO_ZOOM)).toEqual(screenRect(HD, HD, PAD));
  });

  it("is continuous just above scale 1", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 1.0001, cx: 0.2, cy: 0.2 });
    expect(q.x).toBeCloseTo(base.x, 0);
    expect(q.y).toBeCloseTo(base.y, 0);
  });

  it("scales the quad by the zoom factor", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeCloseTo(base.w * 2, 5);
    expect(q.h).toBeCloseTo(base.h * 2, 5);
  });

  it("centres a centred focus point", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.x + q.w / 2).toBeCloseTo(HD.w / 2, 5);
    expect(q.y + q.h / 2).toBeCloseTo(HD.h / 2, 5);
  });

  it("clamps so an oversized quad never exposes background at an edge", () => {
    // focus hard left; the quad is wider than the output, so x must not go positive
    const q = screenQuad(HD, HD, PAD, { scale: 3, cx: 0, cy: 0.5 });
    expect(q.w).toBeGreaterThan(HD.w);
    expect(q.x).toBeLessThanOrEqual(0);
    expect(q.x + q.w).toBeGreaterThanOrEqual(HD.w);
  });

  it("keeps padding visible when the quad is still smaller than the output", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 1.1, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeLessThan(HD.w);
    expect(q.x).toBeGreaterThan(0);
  });

  it("moves the focus point toward the centre as scale grows", () => {
    const off = { cx: 0.2, cy: 0.5 };
    const base = screenRect(HD, HD, PAD);
    const focusAt = (scale: number): number => {
      const q = screenQuad(HD, HD, PAD, { ...off, scale });
      return q.x + off.cx * q.w;
    };
    const centre = HD.w / 2;
    const near = Math.abs(focusAt(1) - centre);
    const far = Math.abs(focusAt(1.5) - centre);
    expect(far).toBeLessThan(near);
    expect(base.w).toBeGreaterThan(0);
  });
});

/**
 * The camera must not teleport.
 *
 * `maxComfortableZoom` is `source.w / (output.w * paddingFactor)`, which equals
 * `1 / paddingFactor` whenever output matches source — exactly the scale at
 * which the quad's width reaches the output's. Any discontinuity parked there
 * is hit by every zoom that reaches the ceiling, which on a 1080p-into-1080p
 * take is every zoom.
 *
 * Property, not pinned values: sweep the scale finely and require each step to
 * move the quad a little. Pinning positions would pass against a curve that
 * jumps between the pinned points.
 */
describe("screenQuad continuity", () => {
  const THRESHOLD = 1 / PAD;
  const CENTRES = [0, 0.05, 0.07005, 0.2, 0.5, 0.8, 0.95, 1];

  it("never moves the quad far in one small step of scale", () => {
    const STEPS = 4000;
    // 4000 steps across the whole zoom range: a continuous path moves well
    // under a pixel per step, so 2px is loose and still catches a teleport.
    const MAX_STEP_PX = 2;

    for (const cx of CENTRES) {
      let worst = 0;
      let worstAt = 0;
      let prev = screenQuad(HD, HD, PAD, { scale: THRESHOLD, cx, cy: 0.5 });

      for (let i = 1; i <= STEPS; i++) {
        const scale = THRESHOLD - (i / STEPS) * (THRESHOLD - 1);
        const q = screenQuad(HD, HD, PAD, { scale, cx, cy: 0.5 });
        const moved = Math.hypot(q.x - prev.x, q.y - prev.y);

        if (moved > worst) {
          worst = moved;
          worstAt = scale;
        }
        prev = q;
      }

      expect(
        worst,
        `cx=${cx} moved ${worst.toFixed(1)}px in one step at scale ${worstAt.toFixed(6)}`,
      ).toBeLessThan(MAX_STEP_PX);
    }
  });

  it("does not jump as the quad stops covering the output", () => {
    // The zoom-out's first eased frame lands a hair below the ceiling. Before
    // the fix this crossing moved the screen 229px right and 110px up on the
    // real take 2026-09-05T13-13-31 (cx 0.07005, cy 0.86782).
    const zoom = { cx: 0.07005, cy: 0.86782 };
    const at = screenQuad(HD, HD, PAD, { ...zoom, scale: THRESHOLD });
    const justBelow = screenQuad(HD, HD, PAD, { ...zoom, scale: THRESHOLD * (1 - 1e-7) });

    expect(Math.abs(justBelow.x - at.x)).toBeLessThan(1);
    expect(Math.abs(justBelow.y - at.y)).toBeLessThan(1);
  });
});
