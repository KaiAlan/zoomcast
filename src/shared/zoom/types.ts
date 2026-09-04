export type EasingName = "zoomEase" | "linear";

export type ZoomConfig = {
  /** How stale a click may be and still anchor a keystroke. */
  keyAnchorWindowMs: number;
  /** Sliding window for grouping impulses into one cluster. */
  clusterWindowMs: number;
  /** Spatial merge radius, in source pixels. */
  clusterRadiusPx: number;
  /** Clusters below this total weight are discarded. */
  minWeight: number;
  /** Clusters closer together than this merge. */
  minGapMs: number;
  /** A zoom may not be replaced sooner than this after it started. */
  minHoldMs: number;
  /** Target hold for an emitted zoom; the floor is transitionMs * 2. */
  minDwellMs: number;
  /** Zooms closer than this become one travelling zoom instead of two. */
  minRecoveryMs: number;
  /** A cluster within this distance extends the previous zoom, not a new one. */
  deadzonePx: number;
  /** Excess clusters in a minute are dropped lowest-weight-first. */
  maxZoomsPerMinute: number;
  /** Padding around cluster bounds when fitting the zoom. */
  marginPx: number;
  /** Start the camera move this long before the cluster begins. */
  leadInMs: number;
  /** Hold the zoom this long after the cluster ends. */
  trailMs: number;
  transitionMs: number;
  easing: EasingName;
};

export type Impulse = {
  t: number;
  x: number;
  y: number;
  w: number;
  srcIndex: number;
};

export type Cluster = {
  startT: number;
  endT: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  weight: number;
  cx: number;
  cy: number;
  anchorIndex: number;
};

export type ZoomKeyframe = {
  id: string;
  tSourceMs: number;
  scale: number;
  cx: number;
  cy: number;
  easing: EasingName;
  transitionMs: number;
  origin: "auto" | "manual";
  pinned: boolean;
};

export type Size = { w: number; h: number };

export type PlanContext = {
  source: Size;
  output: Size;
  paddingFactor: number;
  /** Take length, so the zoom budget is proportional to it. */
  durationMs: number;
};
