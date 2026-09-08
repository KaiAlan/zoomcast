import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG as cfg } from "./config";
import { EASINGS } from "./easing";
import { segmentsToKeyframes } from "./keyframes";

/**
 * Guards for the three camera-feel defects found on 2026-09-08, all reported
 * from the editor preview once it ran fast enough to judge.
 */

/** Per-frame motion of a normalised transition sampled at 60fps. */
function frameDeltas(ease: (x: number) => number, durationMs: number): number[] {
  const step = 1000 / 60;
  const out: number[] = [];
  let prev = 0;
  for (let t = step; t <= durationMs; t += step) {
    const v = ease(t / durationMs);
    out.push(v - prev);
    prev = v;
  }
  return out;
}

describe("the camera does not lurch out of rest", () => {
  /**
   * The bug: `screenStudio` is cubicBezier(0.16, 1, 0.3, 1), an ease-OUT. It
   * starts at maximum velocity, so a camera sitting still jumped 93px in a
   * single frame at 60fps — measured on 2026-09-07T17-22-48 at t=1517ms. That
   * step change in velocity is what "it staggers every zoom" was.
   */
  it("starts a transition from rest, not at peak speed", () => {
    const deltas = frameDeltas(EASINGS[cfg.easing], cfg.transitionMs);
    const first = deltas[0] ?? 0;
    const peak = Math.max(...deltas);

    // A curve that eases in spends its first frame near zero. An ease-out-only
    // curve spends it at the peak, which is the lurch.
    expect(first).toBeLessThan(peak * 0.2);
  });

  it("still decelerates into the destination", () => {
    // The Screen Studio character is a long slow arrival; losing it would make
    // this a plain linear move.
    const deltas = frameDeltas(EASINGS[cfg.easing], cfg.transitionMs);
    const last = deltas[deltas.length - 1] ?? 0;
    expect(last).toBeLessThan(Math.max(...deltas) * 0.2);
  });

  it("keeps screenStudio available and unchanged for reference", () => {
    // Documented in the specs as measured off the reference export. Changing
    // what it means would invalidate those notes.
    const deltas = frameDeltas(EASINGS.screenStudio, 1500);
    expect(deltas[0]).toBeCloseTo(Math.max(...deltas), 5);
  });
});

describe("the pull-out does not start before the activity ends", () => {
  /**
   * The bug: a segment ends at `lastEvent + trailMs` (400ms) and the pull-out
   * starts at `endMs - transitionOutMs` (1000ms), so the camera began leaving
   * 600ms BEFORE the last click. Reported as "sometimes it zooms out while I'm
   * clicking, a little too early".
   */
  it("places the out keyframe so the transition begins no earlier than the last event", () => {
    // endMs is lastEvent + trailMs, and the transition starts transitionOutMs
    // before the keyframe. Fixed by extending the KEYFRAME, not trailMs --
    // trailMs also feeds clustering, and raising it merged shots.
    const seg = { startMs: 4000, endMs: 4000 + cfg.trailMs };
    const outMs = seg.endMs + Math.max(0, cfg.transitionOutMs - cfg.trailMs);
    const pullOutStarts = outMs - cfg.transitionOutMs;
    const lastEvent = seg.endMs - cfg.trailMs;

    expect(pullOutStarts).toBeGreaterThanOrEqual(lastEvent);
  });
});

describe("zoom depth", () => {
  it("reaches far enough to read as a zoom", () => {
    // 1.6 was too shallow to be worth the move.
    expect(cfg.maxZoom).toBeGreaterThanOrEqual(1.9);
  });

  it("keeps the depth ordering click > type > scroll", () => {
    expect(cfg.depthClick).toBeGreaterThan(cfg.depthType);
    expect(cfg.depthType).toBeGreaterThan(cfg.depthScroll);
  });
});

describe("no waypoint is crushed against the one before it", () => {
  /**
   * The bug: two waypoints inside one segment sat 260ms apart with a 0.667
   * depth difference, so the camera covered ~640px in a quarter second — 190px
   * in a single frame at 60fps, on 2026-09-07T17-22-48 at t=1533ms. zoomAt
   * already re-parameterises a clamped transition correctly; the move was
   * simply too big for the time available, which no easing curve fixes.
   */
  it("gives every waypoint room to arrive from the previous one", () => {
    const ctx = {
      source: { w: 1920, h: 1080 },
      output: { w: 1920, h: 1080 },
      paddingFactor: 0.85,
      durationMs: 60_000,
    };
    const crushed = {
      id: "s1",
      startMs: 1000,
      endMs: 20_000,
      position: "fixed" as const,
      origin: "auto" as const,
      pinned: false,
      waypoints: [
        { id: "a", tMs: 1500, depth: 1, cx: 0.2, cy: 0.5 },
        // 260ms later and far shallower: the exact shape that lurched.
        { id: "b", tMs: 1760, depth: 0.25, cx: 0.8, cy: 0.5 },
      ],
    };

    const kfs = segmentsToKeyframes([crushed], cfg, ctx);
    const ins = kfs.filter((k) => k.id.endsWith("i"));

    expect(ins.length).toBeGreaterThanOrEqual(2);
    expect((ins[1]?.tSourceMs ?? 0) - (ins[0]?.tSourceMs ?? 0)).toBeGreaterThanOrEqual(
      cfg.minWaypointGapMs,
    );
  });
});
