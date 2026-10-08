import { describe, expect, it } from "vitest";
import { colorRgb, hsvRgb, pickerHex, rgbHex, rgbHsv } from "./colorPicker";

describe("color picker conversions", () => {
  it("keeps HEX, RGB and HSB consistent for primaries, grays and arbitrary colors", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000", "#808080", "#eee5d9", "#3478fa", "#fe01ab"]) {
      const rgb = colorRgb(hex);
      expect(rgbHex(hsvRgb(rgbHsv(rgb)))).toBe(hex);
    }
    expect(hsvRgb({ h: 360, s: 100, v: 100 })).toEqual([255, 0, 0]);
  });
  it("preserves every RGB channel through a wide set of HSV round trips", () => {
    for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
      expect(hsvRgb(rgbHsv([r, g, b]))).toEqual([r, g, b]);
    }
  });
  it("retains hue on gray and hue/saturation on black so restoring brightness restores color", () => {
    const previous = { h: 240, s: 80, v: 60 };
    expect(rgbHsv([128, 128, 128], previous).h).toBe(240);
    const black = rgbHsv([0, 0, 0], previous);
    expect(black).toEqual({ h: 240, s: 80, v: 0 });
    expect(hsvRgb({ ...black, v: 100 })).toEqual([51, 51, 255]);
  });
  it("accepts pasted HEX and shorthand while rejecting incomplete values and alpha", () => {
    expect(pickerHex(" #AbC ")).toBe("#aabbcc");
    expect(pickerHex("3478FA")).toBe("#3478fa");
    for (const invalid of ["", "#", "12", "1234", "fffff", "ff00gg", "#3478fa80", "rgb(1,2,3)"]) expect(pickerHex(invalid)).toBeNull();
  });
  it("bounds malformed channel inputs rather than passing NaN to the renderer", () => {
    expect(rgbHex([NaN, -1, 999])).toBe("#0000ff");
    expect(hsvRgb({ h: Infinity, s: 900, v: -5 })).toEqual([0, 0, 0]);
  });
});
