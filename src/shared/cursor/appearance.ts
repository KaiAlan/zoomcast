import type { CursorShape } from "../bundle/types";
import type { CursorAppearance } from "../project/types";
import { CURSOR_SHAPES, type CursorArt } from "./shapes";

export const CURSOR_APPEARANCES: ReadonlyArray<{ id: CursorAppearance; label: string }> = [
  { id: "classic", label: "Classic" },
  { id: "rounded", label: "Rounded" },
  { id: "filled", label: "Filled" },
  { id: "dot", label: "Dot" },
  { id: "outline", label: "Outline" },
];

export function cursorArt(shape: CursorShape, appearance: CursorAppearance): CursorArt {
  if (appearance === "dot") return {
    path: "M24 16 A8 8 0 1 1 8 16 A8 8 0 1 1 24 16 Z",
    hotspot: { x: 16, y: 16 }, viewBox: 32,
  };
  if (appearance === "rounded") return {
    path: "M1 1 Q0 0 0 2 L0 21 Q0 23 2 21 L6 17 L10 25 Q11 27 13 26 L15 25 Q16 24 15 22 L11 15 L18 15 Q20 15 18 13 Z",
    hotspot: { x: 0, y: 0 }, viewBox: 32,
  };
  if (appearance === "outline") return {
    path: "M0 0 L9 25 L13 15 L24 11 Z",
    hotspot: { x: 0, y: 0 }, viewBox: 32,
  };
  return CURSOR_SHAPES[shape];
}

export function cursorPaint(appearance: CursorAppearance): { fill: string; stroke: string; width: number } {
  if (appearance === "classic" || appearance === "rounded") return { fill: "#151515", stroke: "#ffffff", width: 2 };
  if (appearance === "outline") return { fill: "transparent", stroke: "#ffffff", width: 2 };
  return { fill: "#ffffff", stroke: "#000000", width: appearance === "dot" ? 1 : 3 };
}
