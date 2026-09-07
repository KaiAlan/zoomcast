/**
 * `linear` is not a style choice: the follow camera's 100ms samples use it so
 * that what renders between them is the precomputed path and nothing else.
 */
export type EasingName = "zoomEase" | "zoomGlide" | "screenStudio" | "linear";

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
  /** Target hold for an emitted zoom; the floor is transitionOutMs. */
  minDwellMs: number;
  /**
   * The longest a shot may stay in. Without a cap the planner holds a zoom
   * until the next cluster, which is why takes sat 61-64% zoomed against the
   * 28% measured off a Recordly export. Segment length, like minDwellMs, so
   * it includes the zoom-out the shot still has to pay for.
   */
  maxDwellMs: number;
  /** Zooms closer than this become one travelling zoom instead of two. */
  minRecoveryMs: number;
  /** A cluster within this distance extends the previous zoom, not a new one. */
  deadzonePx: number;
  /** Excess clusters in a minute are dropped lowest-weight-first. */
  maxZoomsPerMinute: number;
  /** Start the camera move this long before the cluster begins. */
  leadInMs: number;
  /** Hold the zoom this long after the cluster ends. */
  trailMs: number;
  /** How long the camera takes to arrive. The ease runs BEFORE the keyframe. */
  transitionMs: number;
  /**
   * How long it takes to leave. Separate from `transitionMs` because a good
   * exit is quicker than the entrance: Recordly zooms in over 1523ms and out
   * over 1015ms, and one number for both made the exit as slow as the entry.
   */
  transitionOutMs: number;
  easing: EasingName;
  /**
   * The deepest the camera goes. A sharpness choice, not a geometric limit:
   * above `pixelParityZoom` (~1.18 at 1080p into 1080p) the picture is
   * upscaled. Because the frame is inset by paddingFactor, a zoom of s
   * upscales the source by s * paddingFactor — 1.6 costs 1.36x, not 1.6x.
   *
   * It used to be derived from the output size, which made it exactly the
   * factor at which the old growing frame filled the output, so every zoom
   * landed on it and the camera had nowhere to go.
   */
  maxZoom: number;
  /** Depth for a click-led cluster, 0..1 of maxZoom. See depth.ts. */
  depthClick: number;
  /** Depth for a typing run — shallower, because reading needs context. */
  depthType: number;
  /** Depth for a scroll burst. */
  depthScroll: number;
  /** What fraction of the frame the activity may occupy before pulling back. */
  contextFraction: number;
  /**
   * Intent weights. Separate from `Impulse.w`, which gates `minWeight` and so
   * decides whether a cluster earns a zoom AT ALL — sharing one number would
   * mean tuning how deep a typing zoom goes silently changed how many zooms
   * there are.
   */
  intentWeightClick: number;
  intentWeightKey: number;
  intentWeightWheel: number;
};

export type ImpulseKind = "click" | "key" | "wheel";

export type Impulse = {
  t: number;
  x: number;
  y: number;
  w: number;
  srcIndex: number;
  /**
   * What produced this impulse. Separate from `w`: that weight decides whether
   * a cluster earns a zoom at all, while kind decides how deep the zoom goes.
   */
  kind: ImpulseKind;
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
  /**
   * How many impulses of each kind this cluster absorbed. Counts, not weights —
   * the weighting happens in `clusterIntent`, so the weights stay tunable
   * without re-clustering.
   */
  intentScores: Record<ImpulseKind, number>;
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
