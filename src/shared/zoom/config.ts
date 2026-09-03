import type { ZoomConfig } from "./types";

/**
 * A starting point, not a result. Phase 3 exists to tune these against real
 * footage — which is why the golden-fixture harness and the config panel
 * ship together.
 */
export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  keyAnchorWindowMs: 4000,
  clusterWindowMs: 2000,
  clusterRadiusPx: 250,
  minWeight: 0.8,
  minGapMs: 700,
  minHoldMs: 1500,
  deadzonePx: 120,
  maxZoomsPerMinute: 8,
  marginPx: 80,
  leadInMs: 250,
  trailMs: 400,
  transitionMs: 600,
  easing: "zoomEase",
};
