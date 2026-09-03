import { absorbCluster } from "./cluster";
import type { Cluster, ZoomConfig } from "./types";

const MINUTE_MS = 60_000;

function rateLimit(cs: Cluster[], maxPerMinute: number): Cluster[] {
  const buckets = new Map<number, Cluster[]>();

  for (const c of cs) {
    const key = Math.floor(c.startT / MINUTE_MS);
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [c]);
    else list.push(c);
  }

  const kept: Cluster[] = [];
  for (const list of buckets.values()) {
    kept.push(
      ...[...list].sort((a, b) => b.weight - a.weight).slice(0, maxPerMinute),
    );
  }

  return kept.sort((a, b) => a.startT - b.startT);
}

/**
 * Enforce the three guards that make auto-zoom watchable.
 *
 * Nearly all "seasick" auto-zoom is caused by transition COUNT, not by bad
 * anchor points — so a cluster that would re-zoom too soon, or barely moves
 * the camera, extends the previous zoom instead of starting a new one.
 */
export function applyGuards(cs: Cluster[], cfg: ZoomConfig): Cluster[] {
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

    kept.push({ ...c });
  }

  return rateLimit(kept, cfg.maxZoomsPerMinute);
}
