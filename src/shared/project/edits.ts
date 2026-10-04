import { cutLaneSpan } from "./cutLane";
import type { ZoomConfig, ZoomSegment, ZoomWaypoint } from "../zoom/types";
import { normalizeCuts } from "./cuts";
import { outputDurationMs, outputToSource, sourceSpanToOutput } from "./timeline";
import type { Cut, Project } from "./types";

/** Minimum editable span: an entrance and an exit, with no overlap. */
export function minSegmentMs(cfg: ZoomConfig): number {
  return Math.max(cfg.transitionMs, cfg.zoomInOverlapMs) + cfg.transitionOutMs;
}

function replaceSegment(
  p: Project,
  id: string,
  fn: (s: ZoomSegment, neighbours: { prevEnd: number; nextStart: number }) => ZoomSegment,
  durationMs: number,
): Project {
  const ordered = [...p.zoom.segments].sort((a, b) => a.startMs - b.startMs);
  const i = ordered.findIndex((s) => s.id === id);
  if (i === -1) return p;

  const target = ordered[i] as ZoomSegment;
  const neighbours = {
    prevEnd: ordered[i - 1]?.endMs ?? 0,
    nextStart: ordered[i + 1]?.startMs ?? durationMs,
  };

  return {
    ...p,
    zoom: {
      ...p.zoom,
      segments: ordered.map((s) => (s.id === id ? fn(target, neighbours) : s)),
    },
  };
}

/**
 * Slide a whole shot, keeping its visible output length across ripple cuts.
 *
 * Clamps against the take and against both neighbours; a segment cannot be
 * dragged past another, because two overlapping segments emit keyframes
 * competing for the same instants and the camera would be told two things at
 * once. See `replanSegments`.
 */
export function moveSegment(
  p: Project,
  id: string,
  deltaMs: number,
  durationMs: number,
): Project {
  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      const span = sourceSpanToOutput(s.startMs, s.endMs, durationMs, p.cuts);
      if (span === null) return s;
      // Range endpoints collapse onto a cut's seam, including neighbours and
      // waypoints inside removed footage. Point mapping would return null.
      const outputEdge = (tMs: number): number =>
        sourceSpanToOutput(0, tMs, durationMs, p.cuts)?.endMs ?? 0;
      const length = span.endMs - span.startMs;
      const lo = outputEdge(prevEnd);
      const hi = outputEdge(nextStart) - length;
      const startOutputMs = Math.max(lo, Math.min(hi, outputEdge(s.startMs + deltaMs)));
      const startMs = Math.max(prevEnd, outputToSource(startOutputMs, durationMs, p.cuts));
      // An end edge at a seam belongs BEFORE its cut; start edges belong
      // after it. Otherwise even a zero-distance drag extends a shot into
      // removed footage and moves its zoom-out transition into that cut.
      const endSourceMs = outputToSource(startOutputMs + length, durationMs, p.cuts);
      const endCut = normalizeCuts(p.cuts, durationMs).find((c) => c.endMs === endSourceMs);
      const endMs = Math.min(nextStart, endCut?.startMs ?? endSourceMs);
      const seen = new Set<number>();
      const waypoints = s.waypoints.map((w) => ({
        ...w,
        tMs: Math.max(startMs, Math.min(endMs, outputToSource(
          startOutputMs + outputEdge(w.tMs) - span.startMs,
          durationMs,
          p.cuts,
        ))),
      })).filter((w) => {
        // Several source waypoints can collapse onto one removed interval.
        // Keep one target there rather than emit competing keyframes.
        if (seen.has(w.tMs)) return false;
        seen.add(w.tMs);
        return true;
      });

      return {
        ...s,
        startMs,
        endMs,
        waypoints,
        pinned: true,
      };
    },
    durationMs,
  );
}

/**
 * How far a waypoint's `tMs` falls outside `[startMs, endMs]`. Zero when it
 * is already inside.
 */
function distanceOutside(tMs: number, startMs: number, endMs: number): number {
  if (tMs < startMs) return startMs - tMs;
  if (tMs > endMs) return tMs - endMs;
  return 0;
}

/**
 * Drop waypoints a resize has pushed outside the segment's new bounds,
 * rather than clamping them into range.
 *
 * Clamping several waypoints into the same edge collapses them onto one
 * timestamp — two keyframes competing for the same instant, the exact
 * failure the no-overlap invariant exists to prevent, produced from inside a
 * single segment. It also recreates the jump `minWaypointGapMs` was added to
 * stop: waypoints squeezed close together produce a huge camera move in a
 * single frame.
 *
 * A segment with no waypoints has no camera target at all, so if dropping
 * would empty the array, the single waypoint nearest the surviving range is
 * kept instead and clamped into bounds.
 */
function clipWaypoints(
  waypoints: ZoomWaypoint[],
  startMs: number,
  endMs: number,
): ZoomWaypoint[] {
  const inRange = waypoints.filter((w) => w.tMs >= startMs && w.tMs <= endMs);
  if (inRange.length > 0 || waypoints.length === 0) return inRange;

  const nearest = waypoints.reduce((closest, w) =>
    distanceOutside(w.tMs, startMs, endMs) < distanceOutside(closest.tMs, startMs, endMs)
      ? w
      : closest,
  );

  return [{ ...nearest, tMs: Math.max(startMs, Math.min(endMs, nearest.tMs)) }];
}

/**
 * Move one edge. The other stays put; the shot changes length.
 *
 * A waypoint the new bounds leave outside `[startMs, endMs]` is dropped, not
 * clamped — see `clipWaypoints`.
 */
export function resizeSegment(
  p: Project,
  id: string,
  edge: "start" | "end",
  tMs: number,
  durationMs: number,
): Project {
  const min = minSegmentMs(p.zoom.config);

  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      if (edge === "start") {
        const startMs = Math.max(prevEnd, Math.min(s.endMs - min, tMs));
        return {
          ...s,
          startMs,
          waypoints: clipWaypoints(s.waypoints, startMs, s.endMs),
          pinned: true,
        };
      }

      const endMs = Math.min(nextStart, Math.max(s.startMs + min, tMs));
      return {
        ...s,
        endMs,
        waypoints: clipWaypoints(s.waypoints, s.startMs, endMs),
        pinned: true,
      };
    },
    durationMs,
  );
}

/**
 * Map a segment drag's absolute OUTPUT-ms target for the start edge to the
 * SOURCE delta `moveSegment` expects (spec §7). Both edges and waypoint
 * offsets are then mapped in output time, so cuts cannot change its width.
 *
 * Segments store source time; the timeline draws -- and drags measure --
 * output time. `targetStartOutputMs` is the region's own new start edge,
 * absolute rather than a delta-from-drag-start: see `useRegionDrag`'s doc
 * comment for why the caller reports it that way, and why that is what
 * makes this safe to call repeatedly with the same target as a gesture
 * progresses. Returns `p` unchanged if the segment does not exist.
 */
export function segmentDragToSource(
  p: Project,
  id: string,
  targetStartOutputMs: number,
  durationMs: number,
): Project {
  const s = p.zoom.segments.find((x) => x.id === id);
  if (s === undefined) return p;
  const targetSourceMs = outputToSource(targetStartOutputMs, durationMs, p.cuts);
  return moveSegment(p, id, targetSourceMs - s.startMs, durationMs);
}

/**
 * Map a segment resize's absolute OUTPUT-ms edge target to the SOURCE `tMs`
 * `resizeSegment` expects (spec §7).
 *
 * Each edge maps through `outputToSource` independently: resizing the start
 * edge never touches the end edge's source position, and vice versa. A
 * segment resized across a cut therefore changes its source duration --
 * the dragged edge's source position jumps by the cut's length the instant
 * the pointer's output position crosses it -- while the edge's OUTPUT
 * position tracks the pointer exactly, because output time is what a
 * viewer sees and what a drag is measured in.
 */
export function segmentResizeToSource(
  p: Project,
  id: string,
  edge: "start" | "end",
  tOutputMs: number,
  durationMs: number,
): Project {
  return resizeSegment(p, id, edge, outputToSource(tOutputMs, durationMs, p.cuts), durationMs);
}

/**
 * One depth for the whole shot.
 *
 * A travelling segment holds one depth and pans; varying depth across
 * waypoints is not exposed, so this writes to all of them.
 */
export function setSegmentDepth(p: Project, id: string, depth: number): Project {
  const clamped = Math.max(0, Math.min(1, depth));

  return replaceSegment(
    p,
    id,
    (s) => ({
      ...s,
      waypoints: s.waypoints.map((w) => ({ ...w, depth: clamped })),
      pinned: true,
    }),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Switch one shot's camera.
 *
 * Deliberately does NOT pin. Pinning would keep the whole segment wholesale,
 * so the shot would stop re-planning its times when a pacing dial moves —
 * which is not what "switch this shot to follow" asks for. `replanSegments`
 * carries the choice across by id instead.
 */
export function setSegmentCamera(
  p: Project,
  id: string,
  position: "fixed" | "follow",
): Project {
  return replaceSegment(p, id, (s) => ({ ...s, position, cameraOverride: true }), Number.POSITIVE_INFINITY);
}

export function deleteSegment(p: Project, id: string): Project {
  const segments = p.zoom.segments.filter((s) => s.id !== id);
  if (segments.length === p.zoom.segments.length) return p;
  return { ...p, zoom: { ...p.zoom, segments } };
}

/** Hand the shot back to the planner. The caller must re-plan afterwards. */
export function resetSegment(p: Project, id: string): Project {
  return replaceSegment(
    p,
    id,
    (s) => ({ ...s, pinned: false, position: "follow", cameraOverride: false }),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * The shortest cut worth having.
 *
 * Unlike a segment's floor this is arbitrary — a cut has no transitions to pay
 * for. It exists only so a stray click cannot author a 1ms cut that is
 * invisible and unclickable on the timeline.
 */
export const MIN_CUT_MS = 100;

function withCuts(p: Project, cuts: Cut[], durationMs: number, preferId?: string): Project {
  return { ...p, cuts: normalizeCuts(cuts, durationMs, preferId) };
}

/** The id comes from the caller so this stays pure and the tests stay stable. */
export function addCut(
  p: Project,
  id: string,
  startMs: number,
  endMs: number,
  durationMs: number,
): Project {
  return withCuts(p, [...p.cuts, { id, startMs, endMs }], durationMs);
}

/**
 * Slide a cut, keeping its length.
 *
 * `preferId` makes this cut the survivor of any merge: without it, dragging
 * one cut onto another destroys the dragged cut mid-gesture and the drag is
 * left addressing something that no longer exists.
 */
export function moveCut(
  p: Project,
  id: string,
  deltaMs: number,
  durationMs: number,
): Project {
  const target = p.cuts.find((c) => c.id === id);
  if (target === undefined) return p;

  const length = target.endMs - target.startMs;
  const startMs = Math.max(0, Math.min(durationMs - length, target.startMs + deltaMs));

  return withCuts(
    p,
    p.cuts.map((c) => (c.id === id ? { ...c, startMs, endMs: startMs + length } : c)),
    durationMs,
    id,
  );
}

export function resizeCut(
  p: Project,
  id: string,
  edge: "start" | "end",
  tMs: number,
  durationMs: number,
): Project {
  const target = p.cuts.find((c) => c.id === id);
  if (target === undefined) return p;

  const next =
    edge === "start"
      ? { ...target, startMs: Math.max(0, Math.min(target.endMs - MIN_CUT_MS, tMs)) }
      : {
          ...target,
          endMs: Math.min(durationMs, Math.max(target.startMs + MIN_CUT_MS, tMs)),
        };

  return withCuts(
    p,
    p.cuts.map((c) => (c.id === id ? next : c)),
    durationMs,
    id,
  );
}

export function deleteCut(p: Project, id: string): Project {
  const cuts = p.cuts.filter((c) => c.id !== id);
  if (cuts.length === p.cuts.length) return p;
  return { ...p, cuts };
}

/**
 * Slide a cut so its seam lands under the pointer.
 *
 * `targetStartFrac` is the pointer's absolute position across the lane, 0..1,
 * not a delta — see `useRegionDrag` for why every drag callback reports an
 * absolute target.
 *
 * A move is the easy half of task 10's problem: it preserves the cut's
 * length, so it removes exactly as much output as before and the lane's scale
 * holds still for the whole gesture. Resolving the fraction against that scale
 * is therefore exact, and task 9's absolute-target reasoning carries over
 * unmodified. `cutResizeToSource` is where it does not.
 */
export function cutDragToSource(
  p: Project,
  id: string,
  targetStartFrac: number,
  durationMs: number,
): Project {
  const g = cutLaneSpan(p.cuts, id, durationMs);
  if (g === null) return p;

  const lengthMs = g.endMs - g.startMs;
  // The lane's own scale: total output with every cut, this one included.
  const laneDurationMs = g.othersDurationMs - lengthMs;
  const targetSeamMs = targetStartFrac * laneDurationMs;

  // Inverse of the `sourceSpanToOutput` above: a seam position in the others
  // timebase back to the source time that sits there.
  const targetSourceMs = outputToSource(targetSeamMs, durationMs, g.others);
  return moveCut(p, id, targetSourceMs - g.target.startMs, durationMs);
}

/**
 * Move one of a cut's edges to sit under the pointer, at `tFrac` across the
 * lane.
 *
 * This is the case task 9's design does not survive as written, and the
 * reason drag callbacks now report a fraction rather than output ms. Growing
 * a cut removes more material, which shortens `outputDurationMs`, which
 * rescales the lane the drag is being measured in — the scale is a function
 * of the edit being made with it. Converting the pointer to output ms against
 * the live duration and mapping that through `outputToSource` does not just
 * lag: it converges on the wrong length. `outputToSource` adds this cut's own
 * length back when the target is past the seam, so the region's drawn right
 * edge is not the output image of the cut's end at all, and the iteration
 * settles at `othersDurationMs - seam/f` — an edge nowhere near the cursor.
 * Reading the duration live from a ref (the smaller fix) changes none of that.
 *
 * So the fraction is resolved by solving, in closed form, for the geometry
 * that puts the dragged edge under the pointer AFTER the rescale it causes.
 * With `D` = `othersDurationMs`, `s` = seam, `e` = the end in that same
 * timebase and `f` = `tFrac`, the lane draws the region over
 * `[s, e] / (D - (e - s))`, so:
 *
 *   end edge:    (s + len) / (D - len) = f   =>  len = (f·D - s) / (1 + f)
 *   start edge:  s' / (D - (e - s')) = f     =>  s'  = f·(D - e) / (1 - f)
 *
 * Both are functions of the pointer alone — `D`, `s` and `e` are fixed by the
 * other cuts and the edge that is not moving — so they keep every property
 * task 9 wanted: idempotent under `applyTransient`'s re-application, monotone
 * in the pointer, and unable to bank a clamped movement, since the next step
 * is solved afresh from the same fraction rather than accumulated.
 *
 * A merge is the one discontinuity. When a resize runs one cut into another,
 * `normalizeCuts` absorbs the neighbour during this very call, so this step
 * was solved against a world that no longer exists and the edge overshoots the
 * pointer by the absorbed cut's length. The next pointermove solves against
 * the merged world and lands exactly, so the overshoot is one frame and self
 * correcting — not a drift, and not something that accumulates.
 *
 * One consequence worth knowing: dragging the END edge cannot grow a cut past
 * `(D - s) / 2`, because at that length the region's right edge has reached
 * the right end of the lane. That is the honest limit of drawing a region at
 * source width over an output scale, not a clamp — the seam races rightward
 * under the pointer as the timeline shrinks beneath it. Drag the start edge,
 * or make a second cut, to remove more.
 */
export function cutResizeToSource(
  p: Project,
  id: string,
  edge: "start" | "end",
  tFrac: number,
  durationMs: number,
): Project {
  const g = cutLaneSpan(p.cuts, id, durationMs);
  if (g === null) return p;

  // Off-lane pointer positions have no solution (`1 - f` flips sign past the
  // right end); the clamps in `resizeCut` handle the rest.
  const f = Math.max(0, Math.min(1, tFrac));
  const d = g.othersDurationMs;

  if (edge === "end") {
    const lengthMs = (f * d - g.startMs) / (1 + f);
    return resizeCut(p, id, "end", g.target.startMs + lengthMs, durationMs);
  }

  // f === 1 is "as far right as the lane goes", which is the end of the take.
  const seamMs = f >= 1 ? d : Math.min(d, (f * (d - g.endMs)) / (1 - f));
  return resizeCut(
    p,
    id,
    "start",
    outputToSource(Math.max(0, seamMs), durationMs, g.others),
    durationMs,
  );
}

/**
 * Author a cut from a drag across empty lane space, between two absolute
 * pointer fractions in either order.
 *
 * The `MIN_CUT_MS` floor lives here rather than in the lane, because it is an
 * invariant and not UI polish: `addCut` does not enforce one, so only
 * `normalizeCuts`' zero-length filter stands between a stray gesture and a
 * 1ms cut that is invisible and unclickable on the timeline. Nothing else
 * creates cuts.
 *
 * The floor is checked in OUTPUT time while cuts store SOURCE time, which is
 * safe in that direction only: `outputToSource` has slope >= 1, so the source
 * span is never shorter than the output span it came from.
 *
 * One discrete edit, so the caller pushes it with `apply`, not the transient
 * drag path — nothing is committed until the pointer comes up.
 */
export function createCutFromDrag(
  p: Project,
  id: string,
  aFrac: number,
  bFrac: number,
  durationMs: number,
): Project {
  const laneDurationMs = outputDurationMs(durationMs, p.cuts);
  const clamp = (frac: number): number => Math.max(0, Math.min(1, frac)) * laneDurationMs;

  const startOutputMs = clamp(Math.min(aFrac, bFrac));
  const endOutputMs = clamp(Math.max(aFrac, bFrac));
  // Shorter than the floor is a click, not a drag. A click creates nothing.
  if (endOutputMs - startOutputMs < MIN_CUT_MS) return p;

  return addCut(
    p,
    id,
    outputToSource(startOutputMs, durationMs, p.cuts),
    outputToSource(endOutputMs, durationMs, p.cuts),
    durationMs,
  );
}

/** Add a manual zoom in the next surviving gap, without overlapping shots or cuts. */
export function addSegment(p: Project, startMs: number, durationMs: number, id: string): Project {
  const blocked = [...p.zoom.segments, ...p.cuts].sort((a, b) => a.startMs - b.startMs);
  const minimum = minSegmentMs(p.zoom.config) + 100;
  let start = Math.max(0, Math.min(durationMs, startMs));
  let end = durationMs;
  for (const region of blocked) {
    if (region.endMs <= start) continue;
    if (region.startMs - start >= minimum) { end = region.startMs; break; }
    start = Math.max(start, region.endMs);
  }
  end = Math.min(end, start + Math.max(3000, minimum));
  if (end - start < minimum) return p;
  const segment: ZoomSegment = { id, startMs: start, endMs: end, position: "fixed", origin: "manual", pinned: true,
    waypoints: [{ id: `${id}-focus`, tMs: start, depth: 0.5, cx: 0.5, cy: 0.5 }] };
  return { ...p, zoom: { ...p.zoom, segments: [...p.zoom.segments, segment].sort((a, b) => a.startMs - b.startMs) } };
}
