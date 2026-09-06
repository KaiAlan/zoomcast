import { describe, expect, it } from "vitest";
import { hexToRgb, hexToRgba } from "./color";

describe("hexToRgb", () => {
  it("parses six-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
  });

  it("expands three-digit shorthand", () => {
    expect(hexToRgb("#f00")).toEqual(hexToRgb("#ff0000"));
  });

  it("accepts a missing leading hash and any case", () => {
    expect(hexToRgb("0D0E11")).toEqual(hexToRgb("#0d0e11"));
  });

  it("ignores the alpha byte of an eight-digit hex", () => {
    expect(hexToRgb("#ffffff22")).toEqual([1, 1, 1]);
  });

  /**
   * The style panel pushes its colour field to state on every keystroke, so
   * every partial string on the way to a valid one reaches the renderer.
   * "#0d0e1" used to parse as 0x0d0e1 and flash bright cyan; a non-hex
   * character produced NaN, which goes into uniform3f and is undefined
   * behaviour rather than a wrong colour.
   */
  it("returns black for anything malformed rather than a garbage colour", () => {
    for (const bad of ["#0d0e1", "#gg0000", "", "#", "not a colour", "#12345"]) {
      const [r, g, b] = hexToRgb(bad);
      expect(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)).toBe(true);
      expect([r, g, b]).toEqual([0, 0, 0]);
    }
  });
});

describe("hexToRgba", () => {
  it("reads the alpha byte when there is one", () => {
    expect(hexToRgba("#ffffff00")).toEqual([1, 1, 1, 0]);
    expect(hexToRgba("#ffffffff")).toEqual([1, 1, 1, 1]);
  });

  it("is opaque when no alpha byte is given", () => {
    expect(hexToRgba("#ffffff")).toEqual([1, 1, 1, 1]);
  });

  it("returns fully transparent for anything malformed", () => {
    // Transparent rather than black: a half-typed border colour should make
    // the border disappear for a keystroke, not paint a black ring.
    expect(hexToRgba("#ffff")).toEqual([0, 0, 0, 0]);
    expect(hexToRgba("nonsense")).toEqual([0, 0, 0, 0]);
  });
});
