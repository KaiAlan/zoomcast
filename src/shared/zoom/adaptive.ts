import type { TelemetryEvent } from "../bundle/types";
import { toImpulses } from "./impulses";
import { contextResolver } from "./context";
import { clamp, screenRect, type Rect } from "./geometry";
import { screenQuadFor, lateralAuthority } from "./viewport";
import type { PlanContext, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

const STEP = 1000 / 60;
const LEAD = 280;
type Focus = { scale: number; cx: number; cy: number };
type Activity = { t: number; rect: Rect; depth: number; typing: boolean };
type Point = { t: number; x: number; y: number };
const ease = (v: number) => { const p = clamp(v, 0, 1); return p * p * (3 - 2 * p); };
const union = (a: Rect, b: Rect): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });
function padded(r: Rect, source: PlanContext["source"], fraction = 0.025): Rect {
  const px = Math.max(12, source.w * fraction), py = Math.max(12, source.h * fraction);
  const x = clamp(r.x - px, 0, source.w), y = clamp(r.y - py, 0, source.h);
  return { x: x / source.w, y: y / source.h,
    w: (clamp(r.x + r.w + px, 0, source.w) - x) / source.w,
    h: (clamp(r.y + r.h + py, 0, source.h) - y) / source.h };
}

/** Fit actual projected geometry, including padding, edge controls and aspect changes. */
export function fitContext(rect: Rect, desired: number, preferred: { cx: number; cy: number }, ctx: PlanContext): Focus {
  const base = screenRect(ctx.source, ctx.output, ctx.paddingFactor);
  const solve = (scale: number): Focus | null => {
    const authority = lateralAuthority(scale, ctx.paddingFactor);
    const axis = (min: number, size: number, span: number, out: number, centre: number): number | null => {
      const full = span * scale, q0 = (out - full) / 2;
      const coefficient = span * (scale - 1 / scale) * authority;
      const low = Math.max(Math.min(0, out - full), -min * full);
      const high = Math.min(Math.max(0, out - full), out - (min + size) * full);
      if (low > high + 0.00001) return null;
      if (coefficient < 0.00001) return q0 >= low - 0.00001 && q0 <= high + 0.00001 ? 0.5 : null;
      return clamp(centre, 0.5 + (q0 - high) / coefficient, 0.5 + (q0 - low) / coefficient);
    };
    const cx = axis(rect.x, rect.w, base.w, ctx.output.w, preferred.cx);
    const cy = axis(rect.y, rect.h, base.h, ctx.output.h, preferred.cy);
    return cx === null || cy === null ? null : { scale, cx, cy };
  };
  const exact = solve(Math.max(1, desired));
  if (exact) return exact;
  let low = 1, high = Math.max(1, desired), best = solve(1) ?? { scale: 1, cx: 0.5, cy: 0.5 };
  for (let i = 0; i < 18; i++) { const mid = (low + high) / 2, fit = solve(mid); if (fit) { best = fit; low = mid; } else high = mid; }
  return best;
}

/** Build once per derivation. No provider queries or frame-rate-dependent state. */
export function adaptiveCamera(events: TelemetryEvent[], cfg: ZoomConfig, ctx: PlanContext): (segment: ZoomSegment) => ZoomKeyframe[] {
  const resolve = contextResolver(events);
  const activity: Activity[] = toImpulses(events, cfg).map(i => {
    const control = resolve(i.t, i.kind === "click" ? "down" : i.kind === "key" ? "key" : "wheel");
    // Opaque canvases still get enough room to show nearby tools/content.
    const w = ctx.source.w * (i.kind === "key" ? 0.30 : i.kind === "wheel" ? 0.38 : 0.18);
    const h = ctx.source.h * (i.kind === "key" ? 0.24 : i.kind === "wheel" ? 0.40 : 0.18);
    const rect = control?.rect ?? { x: i.x - w / 2, y: i.y - h / 2, w, h };
    return { t: i.t, rect: padded(rect, ctx.source), typing: i.kind === "key",
      depth: i.kind === "key" ? cfg.depthType : i.kind === "wheel" ? cfg.depthScroll : cfg.depthClick };
  });
  const points: Point[] = events.filter((e): e is Extract<TelemetryEvent, { k: "move" | "down" | "up" | "wheel" }> =>
    e.k === "move" || e.k === "down" || e.k === "up" || e.k === "wheel").map(e => ({ t: e.t, x: e.x / ctx.source.w, y: e.y / ctx.source.h }));
  const lower = <T extends { t: number }>(items: T[], t: number): number => {
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if ((items[mid]?.t ?? Infinity) < t) lo = mid + 1; else hi = mid; } return lo;
  };
  return segment => {
    const first = segment.waypoints[0];
    if (!first) return [];
    const start = Math.max(0, segment.startMs), end = Math.min(ctx.durationMs, segment.endMs);
    const hasExit = segment.endMs < ctx.durationMs;
    const exitStart = hasExit ? Math.max(start, end - cfg.transitionOutMs) : end;
    let focus: Focus = { scale: 1, cx: first.cx, cy: first.cy };
    const result: ZoomKeyframe[] = [];
    let previousT = start;
    // Include exact input times: a fast click between grid samples must be visible.
    const times = new Set<number>([start, exitStart]);
    for (let n = 1; start + n * STEP < exitStart; n++) times.add(start + n * STEP);
    for (let i = lower(activity, start); i < activity.length && (activity[i]?.t ?? Infinity) <= exitStart; i++) times.add((activity[i]?.t ?? Infinity));
    for (const t of [...times].sort((a, b) => a - b)) {
      const index = lower(activity, t + 0.00001) - 1;
      const current = activity[index];
      const upcoming = activity[index + 1];
      const relevant = current && current.t >= start - LEAD ? current : upcoming;
      const typing = !!current?.typing && t - current.t < 1200;
      let region = relevant?.rect ?? { x: first.cx - 0.1, y: first.cy - 0.1, w: 0.2, h: 0.2 };
      // Anticipate upcoming interactions gradually. This avoids either a late
      // snap or a speed cap that leaves the camera behind a rapid click.
      for (let i = Math.max(0, index + 1); i < activity.length && (activity[i]?.t ?? Infinity) < t + LEAD; i++) {
        const next = activity[i];
        if (!next) continue;
        const mix = ease((t + LEAD - next.t) / (LEAD - 60));
        const combined = union(region, next.rect);
        region = { x: region.x + (combined.x - region.x) * mix, y: region.y + (combined.y - region.y) * mix,
          w: region.w + (combined.w - region.w) * mix, h: region.h + (combined.h - region.h) * mix };
      }
      // While typing, retain the field even if the mouse is parked elsewhere.
      // During pointing/dragging, cover the recent path AND its short lookahead.
      if (!typing) {
        const from = Math.max(0, lower(points, t - 160) - 1);
        for (let i = from; i < points.length && (points[i]?.t ?? Infinity) <= t + 180; i++) {
          const p = points[i];
          if (!p) continue;
          const mix = p.t <= t ? 1 : ease((t + 180 - p.t) / 180);
          const centre = { x: region.x + region.w / 2, y: region.y + region.h / 2 };
          const x = centre.x + (p.x - centre.x) * mix, y = centre.y + (p.y - centre.y) * mix;
          region = union(region, { x: clamp(x - 0.025, 0, 1), y: clamp(y - 0.025, 0, 1), w: Math.min(0.05, 1 - clamp(x - 0.025, 0, 1)), h: Math.min(0.05, 1 - clamp(y - 0.025, 0, 1)) });
        }
      }
      // Limit old context retention during exploration: the next task sets depth.
      const depth = relevant?.depth ?? first.depth;
      const entrance = ease((t - start) / Math.min(cfg.transitionMs, Math.max(1, exitStart - start)));
      const desired = 1 + depth * (cfg.maxZoom - 1) * entrance;
      const dt = t - previousT;
      const preferred = { cx: focus.cx + (region.x + region.w / 2 - focus.cx) * (1 - Math.exp(-dt / 75)),
        cy: focus.cy + (region.y + region.h / 2 - focus.cy) * (1 - Math.exp(-dt / 75)) };
      // Ease deeper; fit can always pull back sufficiently to keep the task visible.
      focus = fitContext(region, Math.min(desired, focus.scale + (desired - focus.scale) * (1 - Math.exp(-dt / 120))), preferred, ctx);
      result.push({ id: `${segment.id}a${result.length}`, tSourceMs: t, ...focus,
        easing: "linear", transitionMs: dt, origin: segment.origin, pinned: segment.pinned });
      previousT = t;
    }
    if (hasExit) result.push({ id: `${segment.id}o`, tSourceMs: end, scale: 1, cx: focus.cx, cy: focus.cy,
      easing: "cameraExit", transitionMs: end - exitStart, origin: segment.origin, pinned: segment.pinned });
    return result;
  };
}

export function contextIsVisible(rect: Rect, focus: Focus, ctx: PlanContext): boolean {
  const quad = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, focus);
  return quad.x + rect.x * quad.w >= -0.001 && quad.y + rect.y * quad.h >= -0.001
    && quad.x + (rect.x + rect.w) * quad.w <= ctx.output.w + 0.001
    && quad.y + (rect.y + rect.h) * quad.h <= ctx.output.h + 0.001;
}
