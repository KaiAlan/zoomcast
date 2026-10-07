import { describe, expect, it } from "vitest";
import type { CursorShape } from "../bundle/types";
import { cursorArt, cursorPaint } from "./appearance";
import { CURSOR_SHAPES } from "./shapes";

describe("selected cursor glyphs", () => {
  it("keeps dot, rounded, and outline selections when hovering links or text", () => {
    for (const shape of Object.keys(CURSOR_SHAPES) as CursorShape[]) {
      for (const appearance of ["dot", "rounded", "outline"] as const) {
        expect(cursorArt(shape, appearance)).toEqual(cursorArt("arrow", appearance));
      }
      expect(cursorArt(shape, "classic")).toEqual(CURSOR_SHAPES[shape]);
      expect(cursorArt(shape, "filled")).toEqual(CURSOR_SHAPES[shape]);
    }
  });
  it("keeps all five choices distinct even on a recorded text or hand cursor", () => {
    for (const shape of ["arrow", "ibeam", "hand"] as const) {
      const styles = ["classic", "rounded", "filled", "dot", "outline"] as const;
      expect(new Set(styles.map(style => JSON.stringify({ art: cursorArt(shape, style), paint: cursorPaint(style) }))).size).toBe(5);
    }
  });
});
