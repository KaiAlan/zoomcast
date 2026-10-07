import { normalizeCuts } from "./cuts";
import type { Cut, SourceClip } from "./types";

export function outputDurationMs(durationMs: number, cuts: Cut[], clips?: SourceClip[]): number {
  if (clips) return clipsFor(durationMs, cuts, clips).reduce((sum, c) => sum + c.endMs - c.startMs, 0);
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
  clips?: SourceClip[],
): number | null {
  if (clips) {
    let offset = 0;
    const ranges = clipsFor(durationMs, cuts, clips);
    for (const [i, c] of ranges.entries()) {
      if (tSource >= c.startMs && (tSource < c.endMs || (i === ranges.length - 1 && tSource === c.endMs))) return offset + tSource - c.startMs;
      offset += c.endMs - c.startMs;
    }
    return null;
  }
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
  clips?: SourceClip[],
): number {
  if (clips) {
    let remaining = Math.max(0, tOutput);
    const ranges = clipsFor(durationMs, cuts, clips);
    for (const c of ranges) {
      const length = c.endMs - c.startMs;
      if (remaining < length) return c.startMs + remaining;
      remaining -= length;
    }
    return ranges.at(-1)?.endMs ?? 0;
  }
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
  clips?: SourceClip[],
): { startMs: number; endMs: number } | null {
  if (clips) return sourceSpansToOutput(startSourceMs, endSourceMs, durationMs, cuts, clips)[0] ?? null;
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

/** Materialize legacy ripple cuts as ordinary clips; explicit ordering wins. */
export function clipsFor(durationMs: number, cuts: Cut[], clips?: SourceClip[]): SourceClip[] {
  if (clips) return clips.map(c => ({ ...c, startMs: Math.max(0, Math.min(durationMs, c.startMs)), endMs: Math.max(0, Math.min(durationMs, c.endMs)) })).filter(c => c.endMs > c.startMs);
  const kept: SourceClip[] = [];
  let cursor = 0;
  for (const cut of normalizeCuts(cuts, durationMs)) {
    if (cursor < cut.startMs) kept.push({ id: `clip-${kept.length}`, startMs: cursor, endMs: cut.startMs });
    cursor = cut.endMs;
  }
  if (cursor < durationMs) kept.push({ id: `clip-${kept.length}`, startMs: cursor, endMs: durationMs });
  return kept;
}

/** Each visible piece separately: reordering must never stretch a zoom across unrelated footage. */
export function sourceSpansToOutput(startMs: number, endMs: number, durationMs: number, cuts: Cut[], clips?: SourceClip[]): Array<{ startMs: number; endMs: number }> {
  if (!clips) { const span = sourceSpanToOutput(startMs, endMs, durationMs, cuts); return span ? [span] : []; }
  let offset = 0;
  const spans: Array<{ startMs: number; endMs: number }> = [];
  for (const c of clipsFor(durationMs, cuts, clips)) {
    const start = Math.max(startMs, c.startMs);
    const end = Math.min(endMs, c.endMs);
    if (end > start) spans.push({ startMs: offset + start - c.startMs, endMs: offset + end - c.startMs });
    offset += c.endMs - c.startMs;
  }
  return spans;
}
