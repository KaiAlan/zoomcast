import { absorbCluster } from "./cluster";
import type { Cluster, ZoomConfig } from "./types";

const MINUTE_MS = 60_000;

/**
 * Spend a duration-scaled zoom budget evenly across the take.
 *
 * Bucketing by wall-clock minute gave a 35s take a whole minute's allowance —
 * eight zooms in 35s is 13.7/min against a nominal cap of 8. And dropping the
 * lowest-weight clusters globally spent the budget wherever the clicking was
 * densest, which on real footage left an 8-second stretch with no zoom at all.
 *
 * So the budget is proportional to the take, and each equal slice of the take
 * may keep its heaviest cluster. A quiet slice simply spends nothing.
 */
export function rateLimit<T extends { startT: number }>(
  cs: T[], cfg: ZoomConfig, durationMs: number, weight: (item: T) => number,
): T[] {
  const budget =
    durationMs > 0
      ? Math.max(1, Math.round((cfg.maxZoomsPerMinute * durationMs) / MINUTE_MS))
      : cfg.maxZoomsPerMinute;

  if (cs.length <= budget) return cs;

  const sliceMs = durationMs > 0 ? durationMs / budget : MINUTE_MS;
  const heaviest = new Map<number, T>();

  for (const c of cs) {
    const slice = Math.min(budget - 1, Math.floor(c.startT / sliceMs));
    const held = heaviest.get(slice);
    if (held === undefined || weight(c) > weight(held)) heaviest.set(slice, c);
  }

  return [...heaviest.values()].sort((a, b) => a.startT - b.startT);
}

/** Merge nearby attention only while it remains part of the same activity. */
export function applyGuards(
  cs: Cluster[],
  cfg: ZoomConfig,
  durationMs: number,
  limitRate = true,
): Cluster[] {
  const kept: Cluster[] = [];

  for (const c of cs) {
    const prev = kept[kept.length - 1];

    if (prev !== undefined) {
      const inDeadzone = Math.hypot(c.cx - prev.cx, c.cy - prev.cy) <= cfg.deadzonePx;
      // Never average unrelated targets across the screen. The segment
      // guard chains them as separate waypoints without leaving the zoom.
      const nearInTime = c.startT - prev.endT <= cfg.clusterWindowMs;

      if (inDeadzone && nearInTime) {
        absorbCluster(prev, c);
        continue;
      }
    }

    // Its own copy, or two clusters absorbed into this one share a scores
    // object with the original.
    kept.push({ ...c, intentScores: { ...c.intentScores } });
  }

  return limitRate ? rateLimit(kept, cfg, durationMs, c => c.weight) : kept;
}
