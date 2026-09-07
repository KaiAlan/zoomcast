import type { DepthConfig, Intent } from "./depth";
import type { Cluster, Impulse, ZoomConfig } from "./types";

function absorbImpulse(c: Cluster, im: Impulse): void {
  const w = c.weight + im.w;
  c.intentScores[im.kind] += 1;
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
  a.intentScores.click += b.intentScores.click;
  a.intentScores.key += b.intentScores.key;
  a.intentScores.wheel += b.intentScores.wheel;
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
      intentScores: { click: 0, key: 0, wheel: 0, [im.kind]: 1 },
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
    // Its own copy: a shallow spread would let two merged clusters share
    // one scores object and double-count.
    merged.push({ ...c, intentScores: { ...c.intentScores } });
  }

  return merged.filter((c) => c.weight >= cfg.minWeight);
}

/**
 * What the user was doing, as one label.
 *
 * The greatest summed intent weight wins. Ties break toward the SHALLOWER
 * intent, which is deterministic and errs the safe way: a viewer can recover
 * from seeing too much context, not from seeing too little.
 *
 * The case this exists for: people click into a field before typing into it,
 * and a typing run wants context rather than the deepest zoom available. One
 * click scores 1.0 against twenty keystrokes at 8.0, so the run reads as
 * typing without needing a special case.
 */
export function clusterIntent(c: Cluster, cfg: DepthConfig): Intent {
  // Shallowest first, so a strict > comparison naturally keeps the shallower
  // one on a tie.
  const ranked: Array<[Intent, number]> = [
    ["scroll", c.intentScores.wheel * cfg.intentWeight.wheel],
    ["type", c.intentScores.key * cfg.intentWeight.key],
    ["click", c.intentScores.click * cfg.intentWeight.click],
  ];

  let best: Intent = "scroll";
  let bestScore = -1;

  for (const [intent, score] of ranked) {
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }

  return best;
}
