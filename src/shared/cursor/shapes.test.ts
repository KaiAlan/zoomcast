import { describe, expect, it } from "vitest";
import { CURSOR_SHAPES } from "./shapes";

const ALL = [
  "arrow", "ibeam", "hand", "ns", "ew", "nwse", "nesw", "wait",
] as const;

describe("CURSOR_SHAPES", () => {
  it("covers every CursorShape", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape]).toBeDefined();
  });

  it("keeps every hotspot inside its viewBox", () => {
    for (const shape of ALL) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.y).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.x).toBeLessThanOrEqual(art.viewBox);
      expect(art.hotspot.y).toBeLessThanOrEqual(art.viewBox);
    }
  });

  it("puts the arrow hotspot at its tip", () => {
    // The arrow's tip is the origin; anything else makes clicks look offset.
    expect(CURSOR_SHAPES.arrow.hotspot).toEqual({ x: 0, y: 0 });
  });

  it("puts the hand hotspot on the fingertip", () => {
    // The topmost point of the first finger's arc (A2 2 ... from 12,8 to 16,8,
    // centred 14,8) is (14,6). A hotspot above the art offsets every click.
    expect(CURSOR_SHAPES.hand.hotspot).toEqual({ x: 14, y: 6 });
  });

  it("centres the hotspot of every resize cursor", () => {
    for (const shape of ["ns", "ew", "nwse", "nesw"] as const) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeCloseTo(art.viewBox / 2, 5);
      expect(art.hotspot.y).toBeCloseTo(art.viewBox / 2, 5);
    }
  });

  it("gives every shape non-empty path data", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape].path.length).toBeGreaterThan(10);
  });
});

/**
 * Path-data grammar checks.
 *
 * These exist because `new Path2D(bad)` does not throw — it silently yields an
 * empty or truncated path — and the fixture emitted no cursor events, so every
 * screenshot and every parity run had only ever drawn `arrow`. A typo in any of
 * the other seven was invisible to the whole harness. Five of the eight shapes
 * were in fact wrong for the entire branch and no automated check noticed.
 */
describe("CURSOR_SHAPES path data", () => {
  /** Split on subpath starts; every command letter used by these shapes. */
  const subpaths = (d: string): string[] =>
    d
      .split(/(?=M)/)
      .map((sp) => sp.trim())
      .filter((sp) => sp.length > 0);

  it("uses only the commands the renderer's Path2D recipe supports", () => {
    for (const shape of ALL) {
      const letters = CURSOR_SHAPES[shape].path.match(/[a-zA-Z]/g) ?? [];
      for (const letter of letters) {
        expect(["M", "L", "A", "Z"], `${shape}: ${letter}`).toContain(letter);
      }
    }
  });

  it("starts every path with a moveto", () => {
    for (const shape of ALL) {
      expect(CURSOR_SHAPES[shape].path.trimStart().startsWith("M"), shape).toBe(true);
    }
  });

  it("closes every subpath of every shape", () => {
    // The single render recipe is stroke-then-fill, and Canvas2D's fill()
    // encloses zero area on an open subpath: it paints nothing and only the
    // black stroke survives. An open subpath is therefore never what was meant.
    for (const shape of ALL) {
      for (const sp of subpaths(CURSOR_SHAPES[shape].path)) {
        expect(sp.trimEnd().endsWith("Z"), `${shape}: unclosed subpath "${sp}"`).toBe(true);
      }
    }
  });

  it("gives every coordinate pair a finite number", () => {
    for (const shape of ALL) {
      const nums = CURSOR_SHAPES[shape].path.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(nums.length, shape).toBeGreaterThan(0);
      for (const n of nums) expect(Number.isFinite(Number(n)), `${shape}: ${n}`).toBe(true);
    }
  });

  it("keeps every drawn point inside its viewBox, so nothing clips at the texture edge", () => {
    for (const shape of ALL) {
      const art = CURSOR_SHAPES[shape];
      // Coordinates only: strip the arc-flag/radius runs so they are not read
      // as points. Every A here is "A rx ry rot large sweep x y".
      const coords = art.path
        .replace(/A[\s,]*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,]+[01][\s,]+[01]/g, "L")
        .match(/-?\d+(\.\d+)?/g) ?? [];
      for (const c of coords) {
        expect(Number(c), `${shape}: ${c}`).toBeGreaterThanOrEqual(0);
        expect(Number(c), `${shape}: ${c}`).toBeLessThanOrEqual(art.viewBox);
      }
    }
  });
});
