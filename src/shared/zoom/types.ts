/**
 * `linear` is not a style choice: the follow camera's 100ms samples use it so
 * that what renders between them is the precomputed path and nothing else.
 */
export type EasingName = "zoomEase" | "zoomGlide" | "linear";

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

/**
 * One focus point the camera visits without pulling back out.
 *
 * `depth` is 0..1 against the derived ceiling rather than an absolute scale:
 * the ceiling comes from the output size, so a stored scale would be wrong the
 * moment the aspect changes.
 */
export type ZoomWaypoint = {
  id: string;
  tMs: number;
  depth: number;
  cx: number;
  cy: number;
};

/**
 * The persisted, editable unit. Keyframes remain the render-time
 * representation, derived from these; segments are what the planner emits, the
 * timeline draws and the user edits.
 *
 * A segment holds its waypoints rather than being one point, because the
 * pacing guards merge two zooms less than `minRecoveryMs` apart into ONE
 * segment that stays in and pans — pulling out and straight back in reads as a
 * flinch. Five of the ten takes on this machine contain such a segment, one of
 * them with three waypoints. Splitting them into separate persisted segments
 * would make "stay in" an emergent property of two segments' times being
 * exactly equal, and one drag in the phase E timeline would reintroduce the
 * flinch the guard exists to prevent.
 */
export type ZoomSegment = {
  id: string;
  startMs: number;
  endMs: number;
  /** Follow is opt-in: the planner always emits "fixed". */
  position: "follow" | "fixed";
  /** One waypoint is an ordinary zoom; several mean the camera travels. */
  waypoints: ZoomWaypoint[];
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
