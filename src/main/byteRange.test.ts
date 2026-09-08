import { describe, expect, it } from "vitest";
import { resolveByteRange } from "./byteRange";

describe("resolveByteRange", () => {
  it("returns null when no header is present", () => {
    expect(resolveByteRange(undefined, 1000)).toBeNull();
    expect(resolveByteRange("", 1000)).toBeNull();
  });

  it("resolves a closed range", () => {
    expect(resolveByteRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
  });

  it("resolves an open-ended range to the last byte", () => {
    expect(resolveByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("resolves a suffix range", () => {
    expect(resolveByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("clamps an end past the file to the last byte", () => {
    expect(resolveByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(resolveByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("reports a start past the end of the file as unsatisfiable", () => {
    expect(resolveByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  });

  it("reports an inverted range as unsatisfiable", () => {
    expect(resolveByteRange("bytes=500-100", 1000)).toBe("unsatisfiable");
  });

  it("ignores a multi-range request rather than serving it wrong", () => {
    expect(resolveByteRange("bytes=0-99,200-299", 1000)).toBeNull();
  });

  it("ignores a non-bytes unit", () => {
    expect(resolveByteRange("items=0-99", 1000)).toBeNull();
  });

  it("treats a zero-length file as unsatisfiable for any range", () => {
    expect(resolveByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});
