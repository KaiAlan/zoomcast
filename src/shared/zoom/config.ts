import type { ZoomConfig } from "./types";

/**
 * Tuned against the real 35s take in tools/tune-planner.ts, not against the
 * synthetic fixtures — those never produced the pacing these guard against.
 *
 * The pacing is set by minHoldMs, minDwellMs and minRecoveryMs.
 * maxZoomsPerMinute is a backstop for pathological input, not a pacing dial:
 * pulled down to 8 it deletes the very clusters that would otherwise merge
 * into one travelling shot, which makes the result worse, not calmer.
 */
export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  keyAnchorWindowMs: 4000,
  clusterWindowMs: 2000,
  clusterRadiusPx: 250,
  minWeight: 0.8,
  minGapMs: 700,
  minHoldMs: 1500,
  minDwellMs: 1400,
  minRecoveryMs: 700,
  deadzonePx: 120,
  maxZoomsPerMinute: 20,
  marginPx: 80,
  leadInMs: 250,
  trailMs: 400,
  transitionMs: 600,
  easing: "zoomEase",
};
