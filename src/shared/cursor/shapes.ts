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
 */
export const CURSOR_SHAPES: Record<CursorShape, CursorArt> = {
  arrow: {
    path: "M0 0 L0 22 L6 16.5 L10 25.5 L14 23.5 L10 15 L18 15 Z",
    hotspot: { x: 0, y: 0 },
    viewBox: V,
  },
  ibeam: {
    path: "M12 4 L20 4 M16 4 L16 28 M12 28 L20 28",
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
    path: "M16 3 L11 10 L21 10 Z M16 29 L11 22 L21 22 Z M16 10 L16 22",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  ew: {
    path: "M3 16 L10 11 L10 21 Z M29 16 L22 11 L22 21 Z M10 16 L22 16",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nwse: {
    path: "M4 4 L14 4 L4 14 Z M28 28 L18 28 L28 18 Z M8 8 L24 24",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nesw: {
    path: "M28 4 L18 4 L28 14 Z M4 28 L14 28 L4 18 Z M24 8 L8 24",
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
