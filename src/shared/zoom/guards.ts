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
function rateLimit(cs: Cluster[], cfg: ZoomConfig, durationMs: number): Cluster[] {
  const budget =
    durationMs > 0
      ? Math.max(1, Math.round((cfg.maxZoomsPerMinute * durationMs) / MINUTE_MS))
      : cfg.maxZoomsPerMinute;

  if (cs.length <= budget) return cs;

  const sliceMs = durationMs > 0 ? durationMs / budget : MINUTE_MS;
  const heaviest = new Map<number, Cluster>();

  for (const c of cs) {
    const slice = Math.min(budget - 1, Math.floor(c.startT / sliceMs));
    const held = heaviest.get(slice);
    if (held === undefined || c.weight > held.weight) heaviest.set(slice, c);
  }

  return [...heaviest.values()].sort((a, b) => a.startT - b.startT);
}

/**
 * Enforce the three guards that make auto-zoom watchable.
 *
 * Nearly all "seasick" auto-zoom is caused by transition COUNT, not by bad
 * anchor points — so a cluster that would re-zoom too soon, or barely moves
 * the camera, extends the previous zoom instead of starting a new one.
 */
export function applyGuards(
  cs: Cluster[],
  cfg: ZoomConfig,
  durationMs: number,
): Cluster[] {
  const kept: Cluster[] = [];

  for (const c of cs) {
    const prev = kept[kept.length - 1];

    if (prev !== undefined) {
      const inDeadzone = Math.hypot(c.cx - prev.cx, c.cy - prev.cy) <= cfg.deadzonePx;
      const tooSoon = c.startT - prev.startT < cfg.minHoldMs;

      if (inDeadzone || tooSoon) {
        absorbCluster(prev, c);
        continue;
      }
    }

    // Its own copy, or two clusters absorbed into this one share a scores
    // object with the original.
    kept.push({ ...c, intentScores: { ...c.intentScores } });
  }

  return rateLimit(kept, cfg, durationMs);
}
