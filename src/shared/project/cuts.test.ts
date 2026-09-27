import { describe, expect, it } from "vitest";
import { normalizeCuts } from "./cuts";

describe("normalizeCuts", () => {
  it("sorts by start time", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 500, endMs: 600 },
        { id: "b", startMs: 100, endMs: 200 },
      ],
      1000,
    );
    expect(out.map((c) => c.startMs)).toEqual([100, 500]);
  });

  it("merges overlapping cuts", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 400 },
        { id: "b", startMs: 300, endMs: 600 },
      ],
      1000,
    );
    expect(out).toEqual([{ id: "a", startMs: 100, endMs: 600 }]);
  });

  it("merges exactly touching cuts", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 300 },
        { id: "b", startMs: 300, endMs: 500 },
      ],
      1000,
    );
    expect(out).toEqual([{ id: "a", startMs: 100, endMs: 500 }]);
  });

  it("swallows a cut fully contained in another", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 900 },
        { id: "b", startMs: 300, endMs: 400 },
      ],
      1000,
    );
    expect(out).toEqual([{ id: "a", startMs: 100, endMs: 900 }]);
  });

  it("repairs reversed bounds", () => {
    expect(normalizeCuts([{ id: "c1", startMs: 600, endMs: 200 }], 1000)).toEqual([
      { id: "c1", startMs: 200, endMs: 600 },
    ]);
  });

  it("clamps to the recording duration", () => {
    expect(normalizeCuts([{ id: "c1", startMs: -100, endMs: 5000 }], 1000)).toEqual([
      { id: "c1", startMs: 0, endMs: 1000 },
    ]);
  });

  it("drops zero-length cuts", () => {
    expect(normalizeCuts([{ id: "c1", startMs: 300, endMs: 300 }], 1000)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [{ id: "c1", startMs: 600, endMs: 200 }];
    normalizeCuts(input, 1000);
    expect(input).toEqual([{ id: "c1", startMs: 600, endMs: 200 }]);
  });

  it("keeps the earlier cut's id when merging", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 400 },
        { id: "b", startMs: 300, endMs: 600 },
      ],
      1000,
    );
    expect(out).toEqual([{ id: "a", startMs: 100, endMs: 600 }]);
  });

  it("keeps the preferred cut's id when merging", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 400 },
        { id: "b", startMs: 300, endMs: 600 },
      ],
      1000,
      "b",
    );
    expect(out).toEqual([{ id: "b", startMs: 100, endMs: 600 }]);
  });

  it("ignores a preferId that is not present", () => {
    const out = normalizeCuts(
      [
        { id: "a", startMs: 100, endMs: 400 },
        { id: "b", startMs: 300, endMs: 600 },
      ],
      1000,
      "zzz",
    );
    expect(out).toEqual([{ id: "a", startMs: 100, endMs: 600 }]);
  });
});
