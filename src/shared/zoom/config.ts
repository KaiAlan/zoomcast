import type { ZoomConfig } from "./types";

/** Camera timings are source milliseconds; segments include both transitions. */
export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  keyAnchorWindowMs: 4000,
  clusterWindowMs: 2000,
  clusterRadiusPx: 250,
  minWeight: 0.8,
  minGapMs: 700,
  minHoldMs: 1500,
  minDwellMs: 1450,
  // A full-screen rest shorter than this chains into one travelling shot.
  minRecoveryMs: 1500,
  deadzonePx: 120,
  maxZoomsPerMinute: 20,
  // The move starts here, rather than another transition duration earlier.
  leadInMs: 250,
  trailMs: 400,
  transitionMs: 1500,
  transitionOutMs: 1100,
  // Minimum arrival offset within the shot; never an extra early lead-in.
  zoomInOverlapMs: 500,
  panMs: 900,
  minWaypointGapMs: 900,
  easing: "cameraZoom",
  maxZoom: 2.4,
  depthClick: 0.917,
  depthType: 0.583,
  depthScroll: 0.25,
  contextFraction: 0.8,
  intentWeightClick: 1,
  intentWeightKey: 0.4,
  intentWeightWheel: 0.3,
};
