import { describe, expect, it } from "vitest";
import { normalizeCuts } from "./cuts";

describe("normalizeCuts", () => {
  it("sorts by start time", () => {
    const out = normalizeCuts(
      [
        { startMs: 500, endMs: 600 },
        { startMs: 100, endMs: 200 },
      ],
      1000,
    );
    expect(out.map((c) => c.startMs)).toEqual([100, 500]);
  });

  it("merges overlapping cuts", () => {
    const out = normalizeCuts(
      [
        { startMs: 100, endMs: 400 },
        { startMs: 300, endMs: 600 },
      ],
      1000,
    );
    expect(out).toEqual([{ startMs: 100, endMs: 600 }]);
  });

  it("merges exactly touching cuts", () => {
    const out = normalizeCuts(
      [
        { startMs: 100, endMs: 300 },
        { startMs: 300, endMs: 500 },
      ],
      1000,
    );
    expect(out).toEqual([{ startMs: 100, endMs: 500 }]);
  });

  it("swallows a cut fully contained in another", () => {
    const out = normalizeCuts(
      [
        { startMs: 100, endMs: 900 },
        { startMs: 300, endMs: 400 },
      ],
      1000,
    );
    expect(out).toEqual([{ startMs: 100, endMs: 900 }]);
  });

  it("repairs reversed bounds", () => {
    expect(normalizeCuts([{ startMs: 600, endMs: 200 }], 1000)).toEqual([
      { startMs: 200, endMs: 600 },
    ]);
  });

  it("clamps to the recording duration", () => {
    expect(normalizeCuts([{ startMs: -100, endMs: 5000 }], 1000)).toEqual([
      { startMs: 0, endMs: 1000 },
    ]);
  });

  it("drops zero-length cuts", () => {
    expect(normalizeCuts([{ startMs: 300, endMs: 300 }], 1000)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [{ startMs: 600, endMs: 200 }];
    normalizeCuts(input, 1000);
    expect(input).toEqual([{ startMs: 600, endMs: 200 }]);
  });
});
