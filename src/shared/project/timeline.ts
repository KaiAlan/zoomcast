import { normalizeCuts } from "./cuts";
import type { Cut } from "./types";

export function outputDurationMs(durationMs: number, cuts: Cut[]): number {
  const removed = normalizeCuts(cuts, durationMs).reduce(
    (sum, c) => sum + (c.endMs - c.startMs),
    0,
  );
  return durationMs - removed;
}

/** Source position to output position, or null when that source time was cut. */
export function sourceToOutput(
  tSource: number,
  durationMs: number,
  cuts: Cut[],
): number | null {
  let removed = 0;

  for (const c of normalizeCuts(cuts, durationMs)) {
    if (tSource >= c.endMs) {
      removed += c.endMs - c.startMs;
      continue;
    }
    if (tSource >= c.startMs) return null;
    break;
  }

  return tSource - removed;
}

/**
 * Output position to source position. Total: every output time has a source.
 *
 * Ripple cuts keep this piecewise with constant slope 1, which is what makes
 * it property-testable. Speed ramps would make the slope vary and force zoom
 * keyframes to be remapped through it — the reason they are out of scope.
 */
export function outputToSource(
  tOutput: number,
  durationMs: number,
  cuts: Cut[],
): number {
  let t = tOutput;

  for (const c of normalizeCuts(cuts, durationMs)) {
    if (t >= c.startMs) {
      t += c.endMs - c.startMs;
      continue;
    }
    break;
  }

  return t;
}

/**
 * The output span a source range occupies, or null when the range is entirely
 * cut away.
 *
 * `sourceToOutput` returns null for a time inside a cut, which is right for a
 * point — a cut instant has no output position — but useless for a range that
 * merely crosses one. A zoom segment routinely does. Each endpoint is instead
 * collapsed onto the cut's seam, so a segment spanning a cut draws as the
 * shorter block it actually occupies rather than disappearing.
 */
export function sourceSpanToOutput(
  startSourceMs: number,
  endSourceMs: number,
  durationMs: number,
  cuts: Cut[],
): { startMs: number; endMs: number } | null {
  const edge = (tSource: number): number => {
    let removed = 0;

    for (const c of normalizeCuts(cuts, durationMs)) {
      if (tSource >= c.endMs) {
        removed += c.endMs - c.startMs;
        continue;
      }
      if (tSource >= c.startMs) return c.startMs - removed;
      break;
    }

    return tSource - removed;
  };

  const startMs = edge(startSourceMs);
  const endMs = edge(endSourceMs);

  return endMs <= startMs ? null : { startMs, endMs };
}
