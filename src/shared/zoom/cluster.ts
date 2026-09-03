import type { Cluster, Impulse, ZoomConfig } from "./types";

function absorbImpulse(c: Cluster, im: Impulse): void {
  const w = c.weight + im.w;
  c.cx = (c.cx * c.weight + im.x * im.w) / w;
  c.cy = (c.cy * c.weight + im.y * im.w) / w;
  c.weight = w;
  c.endT = Math.max(c.endT, im.t);
  c.minX = Math.min(c.minX, im.x);
  c.maxX = Math.max(c.maxX, im.x);
  c.minY = Math.min(c.minY, im.y);
  c.maxY = Math.max(c.maxY, im.y);
}

export function absorbCluster(a: Cluster, b: Cluster): void {
  const w = a.weight + b.weight;
  a.cx = (a.cx * a.weight + b.cx * b.weight) / w;
  a.cy = (a.cy * a.weight + b.cy * b.weight) / w;
  a.weight = w;
  a.endT = Math.max(a.endT, b.endT);
  a.minX = Math.min(a.minX, b.minX);
  a.maxX = Math.max(a.maxX, b.maxX);
  a.minY = Math.min(a.minY, b.minY);
  a.maxY = Math.max(a.maxY, b.maxY);
}

/**
 * Group impulses that are close in both time and space.
 *
 * Clustering rather than reacting per-event is what stops three nearby clicks
 * becoming three separate camera moves.
 */
export function clusterImpulses(imps: Impulse[], cfg: ZoomConfig): Cluster[] {
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;

  for (const im of imps) {
    if (current !== null) {
      const nearInTime = im.t - current.endT <= cfg.clusterWindowMs;
      const nearInSpace =
        Math.hypot(im.x - current.cx, im.y - current.cy) <= cfg.clusterRadiusPx;

      if (nearInTime && nearInSpace) {
        absorbImpulse(current, im);
        continue;
      }
    }

    current = {
      startT: im.t,
      endT: im.t,
      minX: im.x,
      maxX: im.x,
      minY: im.y,
      maxY: im.y,
      weight: im.w,
      cx: im.x,
      cy: im.y,
      anchorIndex: im.srcIndex,
    };
    clusters.push(current);
  }

  return clusters;
}

/**
 * Merge clusters that are too close together in time, then drop the ones too
 * weak to deserve a camera move. Merge runs first so two individually-weak
 * bursts can combine into one that qualifies.
 */
export function mergeAndFilter(cs: Cluster[], cfg: ZoomConfig): Cluster[] {
  const merged: Cluster[] = [];

  for (const c of cs) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && c.startT - prev.endT < cfg.minGapMs) {
      absorbCluster(prev, c);
      continue;
    }
    merged.push({ ...c });
  }

  return merged.filter((c) => c.weight >= cfg.minWeight);
}
