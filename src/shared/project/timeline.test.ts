import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeCuts } from "./cuts";
import { outputDurationMs, outputToSource, sourceToOutput } from "./timeline";
import type { Cut } from "./types";

const DURATION = 10_000;
const CUTS: Cut[] = [{ startMs: 4200, endMs: 7100 }];

describe("timeline — examples", () => {
  it("shortens the output by the total cut length", () => {
    expect(outputDurationMs(DURATION, CUTS)).toBe(7100);
  });

  it("is identity with no cuts", () => {
    expect(sourceToOutput(5000, DURATION, [])).toBe(5000);
    expect(outputToSource(5000, DURATION, [])).toBe(5000);
  });

  it("maps source before a cut unchanged", () => {
    expect(sourceToOutput(4199, DURATION, CUTS)).toBe(4199);
  });

  it("returns null for a source time inside a cut", () => {
    expect(sourceToOutput(5000, DURATION, CUTS)).toBeNull();
  });

  it("shifts source after a cut left by the cut length", () => {
    expect(sourceToOutput(7100, DURATION, CUTS)).toBe(4200);
    expect(sourceToOutput(9000, DURATION, CUTS)).toBe(6100);
  });

  it("skips the cut when mapping output back to source", () => {
    expect(outputToSource(4199, DURATION, CUTS)).toBe(4199);
    expect(outputToSource(4200, DURATION, CUTS)).toBe(7100);
  });

  it("handles two cuts", () => {
    const two: Cut[] = [
      { startMs: 1000, endMs: 2000 },
      { startMs: 5000, endMs: 5500 },
    ];
    expect(outputDurationMs(DURATION, two)).toBe(8500);
    expect(outputToSource(1000, DURATION, two)).toBe(2000);
    expect(outputToSource(4000, DURATION, two)).toBe(5500);
  });
});

const arbCuts = fc
  .array(
    fc.tuple(
      fc.integer({ min: 0, max: DURATION }),
      fc.integer({ min: 0, max: DURATION }),
    ),
    { maxLength: 6 },
  )
  .map((pairs) => pairs.map(([a, b]) => ({ startMs: a, endMs: b })));

describe("timeline — properties", () => {
  it("outputDuration equals duration minus the sum of normalised cuts", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const removed = normalizeCuts(cuts, DURATION).reduce(
          (s, c) => s + (c.endMs - c.startMs),
          0,
        );
        expect(outputDurationMs(DURATION, cuts)).toBe(DURATION - removed);
      }),
    );
  });

  it("outputToSource is monotonically non-decreasing", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const outDur = outputDurationMs(DURATION, cuts);
        let prev = -1;
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          expect(s).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }),
    );
  });

  it("round-trips every output time back to itself", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const outDur = outputDurationMs(DURATION, cuts);
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          expect(sourceToOutput(s, DURATION, cuts)).toBe(t);
        }
      }),
    );
  });

  it("never maps an output time into a cut region", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const norm = normalizeCuts(cuts, DURATION);
        const outDur = outputDurationMs(DURATION, cuts);
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          for (const c of norm) {
            expect(s >= c.startMs && s < c.endMs).toBe(false);
          }
        }
      }),
    );
  });
});
