import type { Cut } from "./types";

/**
 * Sort, repair, clamp and merge cuts.
 *
 * Every timeline function normalises first, so the mapping functions can
 * assume sorted, non-overlapping, in-range cuts and stay simple enough to
 * reason about — which matters, because that mapping is where off-by-ones live.
 *
 * `preferId` names a cut that must survive any merge it takes part in. A drag
 * passes the cut it is moving: without it, dragging cut B onto cut A destroys
 * B mid-gesture and the drag is left addressing a cut that is gone.
 */
export function normalizeCuts(
  cuts: Cut[],
  durationMs: number,
  preferId?: string,
): Cut[] {
  const cleaned = cuts
    .map((c) => ({
      id: c.id,
      startMs: Math.max(0, Math.min(c.startMs, c.endMs)),
      endMs: Math.min(durationMs, Math.max(c.startMs, c.endMs)),
    }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const out: Cut[] = [];

  for (const c of cleaned) {
    const last = out[out.length - 1];
    if (last !== undefined && c.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, c.endMs);
      if (c.id === preferId) last.id = c.id;
      continue;
    }
    out.push({ ...c });
  }

  return out;
}
