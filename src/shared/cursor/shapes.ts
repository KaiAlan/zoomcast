import type { CursorShape } from "../bundle/types";

export type CursorArt = {
  /** SVG path data, in a viewBox x viewBox square. */
  path: string;
  /** The point that sits on the reported pointer coordinate. */
  hotspot: { x: number; y: number };
  viewBox: number;
};

const V = 32;

/**
 * Cursors are drawn, not extracted from Windows HCURSORs.
 *
 * Extraction gets pixel-accurate shapes and a fixed-size bitmap — the one
 * thing that cannot survive being zoomed, which is the entire reason v1
 * decision #6 chose to draw the cursor rather than capture it.
 *
 * EVERY SUBPATH MUST BE CLOSED. cursorTexture renders all eight shapes with one
 * recipe — stroke black, then fill white — and Canvas2D's fill() encloses zero
 * area on an open subpath, so a bare polyline paints nothing and only the black
 * stroke survives. That is not hypothetical: ibeam was three open lines and
 * rendered as a solid black glyph, and the four resize cursors were two closed
 * heads joined by an open stem, which rendered as a black bar between two white
 * arrowheads. Nothing caught it because the fixture emits no cursor events, so
 * only `arrow` had ever been drawn. shapes.test.ts now asserts closure.
 */
export const CURSOR_SHAPES: Record<CursorShape, CursorArt> = {
  arrow: {
    path: "M0 0 L0 22 L6 16.5 L10 25.5 L14 23.5 L10 15 L18 15 Z",
    hotspot: { x: 0, y: 0 },
    viewBox: V,
  },
  ibeam: {
    path: "M10 4 L22 4 L22 6.5 L18 6.5 L18 25.5 L22 25.5 L22 28 L10 28 L10 25.5 L14 25.5 L14 6.5 L10 6.5 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  hand: {
    path:
      "M12 18 L12 8 A2 2 0 0 1 16 8 L16 15 L16 11 A2 2 0 0 1 20 11 L20 15 " +
      "L20 13 A2 2 0 0 1 24 13 L24 22 A6 6 0 0 1 18 28 L16 28 " +
      "A6 6 0 0 1 10 22 L10 18 A2 2 0 0 1 12 18 Z",
    hotspot: { x: 14, y: 6 },
    viewBox: V,
  },
  ns: {
    path: "M16 3 L21 10 L18 10 L18 22 L21 22 L16 29 L11 22 L14 22 L14 10 L11 10 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  ew: {
    path: "M3 16 L10 11 L10 14 L22 14 L22 11 L29 16 L22 21 L22 18 L10 18 L10 21 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nwse: {
    path: "M5 5 L14 7 L12 9 L23 20 L25 18 L27 27 L18 25 L20 23 L9 12 L7 14 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nesw: {
    path: "M27 5 L18 7 L20 9 L9 20 L7 18 L5 27 L14 25 L12 23 L23 12 L25 14 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  wait: {
    path:
      "M16 4 A12 12 0 0 1 28 16 L23 16 A7 7 0 0 0 16 9 Z " +
      "M16 28 A12 12 0 0 1 4 16 L9 16 A7 7 0 0 0 16 23 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
};
