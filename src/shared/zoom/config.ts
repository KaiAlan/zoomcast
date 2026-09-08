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
  /**
   * 450ms of visible hold plus the zoom-out it pays for. 450 is Recordly's
   * MIN_DWELL_DURATION_MS, measured holding on its exports too.
   */
  minDwellMs: 1450,
  /**
   * Zooms closer than this stay in and pan between focus points instead of
   * pulling out and coming back. Recordly chains at 1500ms
   * (CHAINED_ZOOM_PAN_GAP_MS); this was 700ms, which meant the camera
   * retreated to full screen between shots that were plainly related.
   */
  minRecoveryMs: 1500,
  deadzonePx: 120,
  maxZoomsPerMinute: 20,
  leadInMs: 250,
  /**
   * How long a segment runs past its last event.
   *
   * MUST be >= transitionOutMs. The pull-out starts at endMs - transitionOutMs,
   * so a trail shorter than the pull-out means the camera begins leaving
   * BEFORE the activity ends: at 400ms against a 1000ms pull-out it started
   * 600ms before the last click, every time. Reported as "sometimes it zooms
   * out while I'm clicking, a little too early". Guarded in cameraFeel.test.ts.
   */
  trailMs: 400,
  transitionMs: 1500,
  transitionOutMs: 1000,
  /**
   * How long after a region starts the zoom-in finishes.
   *
   * The camera is still arriving as activity begins, rather than sitting
   * settled and waiting for it. Measured off Recordly's ZOOM_IN_OVERLAP_MS.
   * Clamped at emission so it can never push the zoom-in past the next
   * waypoint or the end of its own segment.
   */
  zoomInOverlapMs: 500,
  /** Recordly's CONNECTED_ZOOM_PAN_DURATION_MS, which is its own constant too. */
  panMs: 1000,
  /**
   * The least time a waypoint gets to arrive after the one before it.
   *
   * Without it two waypoints inside one segment could sit 260ms apart with a
   * 0.667 depth difference, and the camera was asked to cover ~640px in a
   * quarter second -- about 2,460px/s, measured as 190px in a single frame at
   * 60fps on 2026-09-07T17-22-48 at t=1533ms. No easing curve rescues a move
   * that large in that little time; it needs room instead.
   *
   * Raising maxZoom to 2.0 made it worse, because the same depth gap became a
   * bigger scale gap.
   */
  minWaypointGapMs: 900,
  /**
   * Measured off a Recordly export the user pointed at as the target look,
   * then confirmed in its source. 90/9/1 across the thirds over a 1523ms
   * window: commit hard, arrive at 95% in 648ms, then settle invisibly.
   *
   * This reverses the 2026-09-07 choice of zoomGlide. That was picked because
   * zoomEase's 184ms drifting tail was blamed for "floaty"; the reference has
   * an 875ms tail and reads as smooth, so the tail was never the problem —
   * the lack of early commitment was. All three stay pickable in the
   * inspector; this line is the only thing that makes one the default.
   */
  easing: "cameraZoom",
  // 1.6 was too shallow to be worth the camera move. At 2.0 a full-depth
  // click zoom lands at 1.92x rather than 1.55x.
  maxZoom: 2.0,
  // Fractions of maxZoom, so one dial deepens everything and the grading
  // between intents survives. At maxZoom 1.6 these are 1.55 / 1.35 / 1.15.
  depthClick: 0.917,
  depthType: 0.583,
  depthScroll: 0.25,
  /**
   * Tuned against real takes, not chosen: at 0.6 and at 0.8 exactly the same
   * single zoom is dropped across every take on disk — the widest cluster,
   * spanning 0.853 of the screen. 0.6 additionally rejected a cluster spanning
   * 0.625, which is the shape of the synthetic test fixture and of any
   * genuinely wide burst of activity, and rejecting those buys nothing.
   */
  contextFraction: 0.8,
  intentWeightClick: 1,
  intentWeightKey: 0.4,
  intentWeightWheel: 0.3,
};
