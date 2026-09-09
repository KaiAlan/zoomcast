import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { pixelParityZoom, screenRect } from "./geometry";
import type { TelemetryEvent } from "../bundle/types";
import { followPath } from "./camera";
import { cursorAt } from "../cursor/path";
import { zoomAt } from "./interpolate";
import { screenQuadFor } from "./viewport";
import { depthToScale, scaleToDepth, segmentsToKeyframes } from "./keyframes";
import type { PlanContext, ZoomSegment } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
  durationMs: 60_000,
};

const cfg = DEFAULT_ZOOM_CONFIG;
/**
 * What full depth renders as. The CAP, not the pixel-parity point — those were
 * the same number before 2026-09-07, which is exactly what pinned every zoom
 * to full-bleed. depthToScale's round-trip tests below still use
 * pixelParityZoom, because that arithmetic is about the mapping, not the cap.
 */
const CEILING = cfg.maxZoom;
const PARITY = pixelParityZoom(ctx.source, ctx.output, ctx.paddingFactor);

/**
 * The fixture's start. It must sit past `cfg.transitionMs`, or `openAtRest`
 * moves it and tests about everything else quietly become tests of that rule.
 * It was 1000 while the transition was 600.
 */
/** transitionOutMs - trailMs: how far past the segment end the pull-out lands. */
const OUT_SHIFT = Math.max(0, cfg.transitionOutMs - cfg.trailMs);

const START = 4000;
const END = 7000;

function seg(over: Partial<ZoomSegment> = {}): ZoomSegment {
  return {
    id: "s1",
    startMs: START,
    endMs: END,
    position: "fixed",
    waypoints: [{ id: "k0", tMs: START, depth: 1, cx: 0.25, cy: 0.5 }],
    origin: "auto",
    pinned: false,
    ...over,
  };
}

describe("segmentsToKeyframes", () => {
  it("emits the in/out pair the planner used to emit itself", () => {
    const kfs = segmentsToKeyframes([seg()], cfg, ctx);

    expect(kfs).toHaveLength(2);
    expect(kfs[0]).toMatchObject({
      id: "k0i",
      // The zoom-in settles zoomInOverlapMs into the region, not at its edge.
      tSourceMs: START + cfg.zoomInOverlapMs,
      cx: 0.25,
      cy: 0.5,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });
    expect(kfs[0]?.scale).toBeCloseTo(CEILING, 12);
    // The out-keyframe sits at the segment's end, at rest, where the last
    // waypoint left the camera.
    expect(kfs[1]).toMatchObject({ id: "k0o", tSourceMs: END + OUT_SHIFT, scale: 1, cx: 0.25 });
  });

  it("emits one in-keyframe per waypoint and a single out-keyframe", () => {
    // A travelling segment: the camera stays in and pans between focus points.
    const kfs = segmentsToKeyframes(
      [
        seg({
          waypoints: [
            { id: "k0", tMs: START, depth: 1, cx: 0.25, cy: 0.5 },
            { id: "k1", tMs: START + 1500, depth: 1, cx: 0.75, cy: 0.5 },
          ],
        }),
      ],
      cfg,
      ctx,
    );

    expect(kfs.map((k) => k.id)).toEqual(["k0i", "k1i", "k1o"]);
    expect(kfs.filter((k) => k.scale === 1)).toHaveLength(1);
  });

  it("sorts by source time", () => {
    const kfs = segmentsToKeyframes(
      [seg({ id: "b", startMs: 9000, endMs: 11_000, waypoints: [{ id: "k1", tMs: 9000, depth: 1, cx: 0.5, cy: 0.5 }] }), seg()],
      cfg,
      ctx,
    );

    expect(kfs.map((k) => k.tSourceMs)).toEqual([
      START + cfg.zoomInOverlapMs,
      END + OUT_SHIFT,
      9000 + cfg.zoomInOverlapMs,
      11_000 + OUT_SHIFT,
    ]);
  });

  it("drops a segment with no waypoints rather than emitting a bare pull-out", () => {
    expect(segmentsToKeyframes([seg({ waypoints: [] })], cfg, ctx)).toEqual([]);
  });
});

describe("depth", () => {
  /**
   * Depth is stored relative because the ceiling derives from the output size:
   * a scale planned against 16:9 would be wrong the moment the user picks 1:1.
   */
  it("round-trips a scale through the ceiling", () => {
    expect(depthToScale(scaleToDepth(PARITY, PARITY), PARITY)).toBeCloseTo(PARITY, 12);
    expect(depthToScale(scaleToDepth(1, PARITY), PARITY)).toBeCloseTo(1, 12);
  });

  it("means the same shot at a different output aspect", () => {
    const square = pixelParityZoom({ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, 0.85);
    expect(square).not.toBeCloseTo(PARITY, 3);
    // Full depth is full depth in both: that is the point of storing 0-1.
    expect(depthToScale(1, square)).toBeCloseTo(square, 12);
  });
});

/**
 * Decision 2. A keyframe at t = 0 cannot be eased into — its transition would
 * have to start at -transitionMs — so zoomAt returns the keyframe's own value
 * from the first frame and the take opens as a hard cut.
 */
describe("opening at rest", () => {
  it("never emits a keyframe whose transition would start before zero", () => {
    const segments = [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })];
    const kfs = segmentsToKeyframes(segments, cfg, ctx);

    for (const k of kfs) {
      expect(k.tSourceMs - k.transitionMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("opens at rest, then eases in", () => {
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(zoomAt(kfs, 0).scale).toBe(1);
    expect(zoomAt(kfs, cfg.transitionMs).scale).toBeGreaterThan(1);
  });

  it("keeps the opening move the same speed as every other move", () => {
    // Shortening the transition instead of moving the keyframe would make the
    // first zoom the fastest one in the take, which is the opposite of intent.
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 3000, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(kfs[0]?.transitionMs).toBe(cfg.transitionMs);
    expect(kfs[0]?.tSourceMs).toBe(cfg.transitionMs);
  });

  it("drops a segment with no room to arrive", () => {
    // A zoom that would have to arrive after its own end is the pathology
    // segments.ts already guards elsewhere.
    const kfs = segmentsToKeyframes(
      [seg({ startMs: 0, endMs: 200, waypoints: [{ id: "k0", tMs: 0, depth: 1, cx: 0.5, cy: 0.5 }] })],
      cfg,
      ctx,
    );

    expect(kfs).toEqual([]);
  });

  it("leaves a segment that already starts late alone", () => {
    // openAtRest must not move it. The zoom-in overlap still applies on top,
    // which is a separate rule -- hence START + the overlap, not START.
    const kfs = segmentsToKeyframes([seg()], cfg, ctx);
    expect(START).toBeGreaterThan(cfg.transitionMs);
    expect(kfs[0]?.tSourceMs).toBe(START + cfg.zoomInOverlapMs);
  });
});

describe("a follow segment", () => {
  // A 1:1 output crops a 16:9 source, which is where a follow has room to pan.
  const square: PlanContext = { ...ctx, output: { w: 1080, h: 1080 } };
  const events: TelemetryEvent[] = [
    { k: "move", t: 0, x: 200, y: 540 },
    { k: "move", t: 1500, x: 1700, y: 540 },
    { k: "move", t: 5000, x: 1700, y: 540 },
  ];
  const path = followPath(events);
  // Explicit waypoints: this block is about the follow sampler, so it must
  // not inherit the shared fixture's start and silently sample nothing.
  const seg5 = seg({
    startMs: 1000,
    endMs: 5000,
    position: "follow",
    waypoints: [{ id: "k0", tMs: 1000, depth: 1, cx: 0.25, cy: 0.5 }],
  });

  it("tracks the cursor between waypoints instead of holding one centre", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const centres = new Set(kfs.filter((k) => k.scale > 1).map((k) => k.cx));

    expect(centres.size).toBeGreaterThan(5);
  });

  it("moves the same way the smoothed path does", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const moving = kfs.filter((k) => k.scale > 1);
    const first = moving[0]?.cx ?? 0;
    const last = moving[moving.length - 1]?.cx ?? 0;

    // The cursor crosses left to right, so the camera does too — lagging it.
    expect(last).toBeGreaterThan(first);
  });

  it("never leaves the source", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);

    const frame = screenRect(square.source, square.output, square.paddingFactor);

    for (const k of kfs.filter((x) => x.scale > 1)) {
      // The bound comes from the quad the renderer actually draws with, not a
      // copy of the formula. This test has carried its own copy twice now and
      // had to be rewritten each time the geometry changed.
      const quad = screenQuadFor(square.source, square.output, square.paddingFactor, {
        scale: k.scale,
        cx: k.cx,
        cy: k.cy,
      });
      // An oversized window must never let the background back in.
      if (quad.w >= square.output.w) {
        expect(quad.x).toBeLessThanOrEqual(1e-6);
        expect(quad.x + quad.w).toBeGreaterThanOrEqual(square.output.w - 1e-6);
      }
    }
  });

  it("ramps linearly between samples so the precomputed path is what renders", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const samples = kfs.filter((k) => k.id.includes("f"));

    expect(samples.length).toBeGreaterThan(0);
    for (const k of samples) {
      expect(k.easing).toBe("linear");
      expect(k.transitionMs).toBe(100);
    }
  });

  /**
   * Regression for 2026-09-08.
   *
   * `seg5` above starts at 1000, so `openAtRest` moves its waypoint to
   * `transitionMs` and the in-keyframe happens to land where the follow grid
   * expects it. A shot that starts after the opening transition does not get
   * that reprieve: `zoomInOverlapMs` moves its in-keyframe and the grid was
   * still laid out from the waypoint's original `tMs`. That is the shape the
   * planner emits on a real take.
   *
   * Measured on take 2026-09-08T14-53-54 with every shot forced to follow: a
   * follow sample landed on exactly the in-keyframe's timestamp, and because
   * `zoomAt` then had a zero-width window between them the camera snapped from
   * x=1170.5 to x=870.7 — 296px in a single frame.
   */
  const segLate = seg({
    startMs: 2000,
    endMs: 5000,
    position: "follow",
    waypoints: [{ id: "k0", tMs: 2000, depth: 1, cx: 0.25, cy: 0.5 }],
  });

  it("starts sampling where the zoom-in arrives, not where the waypoint is", () => {
    const kfs = segmentsToKeyframes([segLate], cfg, square, path);
    const settle = kfs.find((k) => k.id === "k0i")?.tSourceMs ?? 0;
    const samples = kfs.filter((k) => k.id.startsWith("k0f"));

    // The waypoint is at 2000; the camera does not arrive until 2500.
    expect(settle).toBe(2000 + cfg.zoomInOverlapMs);
    expect(samples.length).toBeGreaterThan(0);
    for (const k of samples) expect(k.tSourceMs).toBeGreaterThan(settle);
  });

  it("never puts two keyframes on the same timestamp", () => {
    for (const s of [seg5, segLate]) {
      const times = segmentsToKeyframes([s], cfg, square, path).map((k) => k.tSourceMs);
      expect(new Set(times).size).toBe(times.length);
    }
  });

  /**
   * The collision was a discontinuity, not a kink: two keyframes sharing a
   * timestamp give `zoomAt` a zero-width window, and it jumps.
   *
   * The bound is the path's own speed rather than a constant, because the path
   * is legitimately fast — `seg5`'s cursor teleports 1500px at t=1500 and the
   * 300ms lag chasing it covers 40px in a frame. What must not happen is the
   * camera outrunning the thing it is following.
   */
  it("moves no faster than the path it follows, once it has arrived", () => {
    const frameMs = 1000 / 60;

    for (const s of [seg5, segLate]) {
      const kfs = segmentsToKeyframes([s], cfg, square, path);
      const settle = kfs.find((k) => k.id === "k0i")?.tSourceMs ?? 0;

      const cameraAt = (t: number): number => zoomAt(kfs, t).cx * square.source.w;
      const pathAt = (t: number): number => cursorAt(path, t)?.x ?? 0;

      let camera = 0;
      let cursor = 0;
      for (let t = settle + frameMs; t <= s.endMs - cfg.transitionOutMs; t += frameMs) {
        camera = Math.max(camera, Math.abs(cameraAt(t) - cameraAt(t - frameMs)));
        cursor = Math.max(cursor, Math.abs(pathAt(t) - pathAt(t - frameMs)));
      }

      expect(camera).toBeLessThanOrEqual(cursor * 1.1);
    }
  });

  it("pulls out so the transition begins at the segment's end", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const last = kfs[kfs.length - 1];

    expect(last?.tSourceMs).toBe(5000 + OUT_SHIFT);
    expect(last?.scale).toBe(1);
  });

  /**
   * Without a path there is nothing to follow — the tune tool and the planner
   * tests derive keyframes without building one, and must still get a shot.
   */
  it("falls back to its waypoints when no path is supplied", () => {
    const withPath = segmentsToKeyframes([seg5], cfg, square, path);
    const without = segmentsToKeyframes([seg5], cfg, square);

    expect(without).toHaveLength(2);
    expect(without[0]?.cx).toBe(0.25);
    expect(withPath.length).toBeGreaterThan(without.length);
  });

  it("leaves a fixed segment alone even when a path exists", () => {
    expect(segmentsToKeyframes([seg()], cfg, square, path)).toEqual(
      segmentsToKeyframes([seg()], cfg, square),
    );
  });
});

/** Invariant 8: depth is relative, so the ceiling can move under it. */
describe("maxZoom", () => {
  it("maps full depth onto the configured ceiling", () => {
    const kfs = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 1.6 }, ctx);
    expect(kfs[0]?.scale).toBeCloseTo(1.6, 9);
  });

  it("does not invalidate a stored depth when the ceiling changes", () => {
    // Same stored segment, same normalised depth, different rendered scale.
    const shallow = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 1.2 }, ctx);
    const deep = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 2.0 }, ctx);

    expect(shallow[0]?.scale).toBeCloseTo(1.2, 9);
    expect(deep[0]?.scale).toBeCloseTo(2.0, 9);
  });

  it("no longer ties the ceiling to the output size", () => {
    // Before 2026-09-07 this was maxComfortableZoom, so a 1:1 output planned a
    // different scale for the same segment. The camera samples 1/scale of the
    // source at any aspect now, so it does not.
    const square: PlanContext = { ...ctx, output: { w: 1080, h: 1080 } };
    const a = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 1.6 }, ctx);
    const b = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 1.6 }, square);

    expect(a[0]?.scale).toBeCloseTo(b[0]?.scale ?? 0, 12);
  });
});

describe("asymmetric transitions", () => {
  it("gives the zoom-out its own duration", () => {
    // Recordly zooms in over 1523ms and out over 1015ms. One number for both
    // made the exit as slow as the entrance, which is not what reads well.
    const cfg = { ...DEFAULT_ZOOM_CONFIG, transitionMs: 1500, transitionOutMs: 1000 };
    const kfs = segmentsToKeyframes([seg({ startMs: 4000, endMs: 9000 })], cfg, ctx);

    const zin = kfs.find((k) => k.scale > 1);
    const zout = kfs.find((k) => k.scale === 1);

    expect(zin?.transitionMs).toBe(1500);
    expect(zout?.transitionMs).toBe(1000);
  });
});

describe("panning between focus points", () => {
  const travelling = seg({
    startMs: START,
    endMs: START + 6000,
    waypoints: [
      { id: "k0", tMs: START, depth: 1, cx: 0.25, cy: 0.5 },
      { id: "k1", tMs: START + 2000, depth: 1, cx: 0.75, cy: 0.5 },
      { id: "k2", tMs: START + 4000, depth: 1, cx: 0.5, cy: 0.8 },
    ],
  });

  it("moves between focus points on its own curve and duration", () => {
    // A pan is not a zoom. Reusing the zoom-in's curve put 90% of a sideways
    // camera move into its first third, which reads as a lurch; the reference
    // pans on a gentler 65/28/7 curve at 60% of the peak speed.
    const kfs = segmentsToKeyframes([travelling], cfg, ctx);
    const ins = kfs.filter((k) => k.scale > 1);

    expect(ins).toHaveLength(3);
    expect(ins[0]).toMatchObject({ easing: cfg.easing, transitionMs: cfg.transitionMs });
    for (const k of ins.slice(1)) {
      expect(k.easing).toBe("cameraPan");
      expect(k.transitionMs).toBe(cfg.panMs);
    }
  });

  it("still leaves on the zoom-out duration, not the pan one", () => {
    const kfs = segmentsToKeyframes([travelling], cfg, ctx);
    const out = kfs.find((k) => k.scale === 1);

    expect(out?.transitionMs).toBe(cfg.transitionOutMs);
  });
});

describe("zoomInOverlapMs", () => {
  it("finishes the zoom-in after the region starts, not at it", () => {
    const kfs = segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 500 }, ctx);

    expect(kfs[0]).toMatchObject({ id: "k0i", tSourceMs: START + 500 });
  });

  it("is a no-op at zero overlap", () => {
    const kfs = segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 0 }, ctx);

    expect(kfs[0]).toMatchObject({ id: "k0i", tSourceMs: START });
  });

  it("still emits exactly the in/out pair", () => {
    // The overlap shifts when a keyframe lands. If it changes how many are
    // emitted, it is leaking into segment selection, which is a bug.
    expect(segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 500 }, ctx)).toHaveLength(2);
  });

  it("never pushes the zoom-in past the end of its own segment", () => {
    // A short segment with a long overlap must not settle after it is over.
    const short = seg({ startMs: START, endMs: START + 200 });
    const kfs = segmentsToKeyframes([short], { ...cfg, zoomInOverlapMs: 5000 }, ctx);

    expect(kfs[0]?.tSourceMs).toBeLessThanOrEqual(short.endMs);
  });
});
