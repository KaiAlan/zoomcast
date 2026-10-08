import type { TelemetryEvent } from "../bundle/types";
import { cursorAt } from "../cursor/path";
import { followPath } from "./camera";
import { EASINGS } from "./easing";
import { contextResolver } from "./context";
import { clamp, screenRect, type Rect } from "./geometry";
import { screenQuadFor, lateralAuthority } from "./viewport";
import type { PlanContext, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

const STEP = 1000 / 60;

type Focus = { scale: number; cx: number; cy: number };
type Stage = { t: number; endT: number; rect: Rect; depth: number; semantic: boolean; burst: boolean };
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

/** Closed-form damping carries velocity instead of clamping the rendered position. */
function damp(value: number, velocity: number, target: number, dt: number, maxSpeed: number, maxAcceleration: number) {
  if (dt <= 0) return { value, velocity };
  const frequency = 12;
  const displacement = value - target, b = velocity + frequency * displacement;
  const decay = Math.exp(-frequency * dt);
  const next = target + (displacement + b * dt) * decay;
  const naturalVelocity = (velocity - frequency * b * dt) * decay;
  const requested = clamp(naturalVelocity, -maxSpeed, maxSpeed);
  const speed = clamp(requested, velocity - maxAcceleration * dt, velocity + maxAcceleration * dt);
  // Keep the analytical velocity when unconstrained. Storing frame-average
  // travel as velocity turns a critically damped response into an oscillator.
  return { value: speed === naturalVelocity ? next : value + (velocity + speed) * dt / 2, velocity: speed };
}
const interpolateRect = (from: Rect, to: Rect, progress: number): Rect => ({
  x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress,
  w: from.w + (to.w - from.w) * progress, h: from.h + (to.h - from.h) * progress,
});

/** Stable click-led framing. Pointer travel changes pan, never zoom depth. */
export function adaptiveCamera(events: TelemetryEvent[], cfg: ZoomConfig, ctx: PlanContext): (segment: ZoomSegment) => ZoomKeyframe[] {
  const resolve = contextResolver(events);
  const path = followPath(events);
  const rawPath = followPath(events, { halfLifeMs: 0 });
  const clicks = events.filter((e): e is Extract<TelemetryEvent, { k: "down" }> => e.k === "down");
  const positions: Point[] = events.filter((e): e is Extract<TelemetryEvent, { k: "move" | "down" | "up" }> => e.k === "move" || e.k === "down" || e.k === "up")
    .map(e => ({ t: e.t, x: e.x, y: e.y }));
  const ups = events.filter((e): e is Extract<TelemetryEvent, { k: "up" }> => e.k === "up");
  const keys = events.filter((e): e is Extract<TelemetryEvent, { k: "key" }> => e.k === "key" && e.d === "down");
  const lower = <T extends { t: number }>(items: T[], t: number): number => {
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if ((items[mid]?.t ?? Infinity) < t) lo = mid + 1; else hi = mid; } return lo;
  };
  const stages: Stage[] = clicks.map((click, index) => {
    let control = resolve(click.t, "down");
    // A focused-field reply can arrive after the click. Use it for that same
    // field from the outset rather than changing depth on each keystroke.
    if (!control) for (let i = lower(keys, click.t); i < keys.length; i++) {
      const key = keys[i];
      if (!key || key.t > Math.min(click.t + cfg.keyAnchorWindowMs, clicks[index + 1]?.t ?? Infinity)) break;
      const focused = resolve(key.t, "key");
      if (focused && click.x >= focused.rect.x && click.x <= focused.rect.x + focused.rect.w
        && click.y >= focused.rect.y && click.y <= focused.rect.y + focused.rect.h) { control = focused; break; }
    }
    const fallback = { x: click.x - ctx.source.w * 0.09, y: click.y - ctx.source.h * 0.09, w: ctx.source.w * 0.18, h: ctx.source.h * 0.18 };
    let rect = padded(control?.rect ?? fallback, ctx.source);
    let drag = false;
    // Fit an actual drag's path before entering; hovering is not a drag.
    const candidate = ups[lower(ups, click.t)];
    const up = candidate?.b === click.b && candidate.t < (clicks[index + 1]?.t ?? click.t + 10000) ? candidate : undefined;
    if (up) for (let i = lower(positions, click.t); i < positions.length; i++) {
      const point = positions[i]; if (!point || point.t > up.t) break;
      if (Math.hypot(point.x - click.x, point.y - click.y) < 24) continue;
      drag = true;
      rect = union(rect, padded({ x: point.x, y: point.y, w: 1, h: 1 }, ctx.source));
    }
    return { t: click.t, endT: click.t, rect, depth: control?.role === "Edit" || control?.role === "ComboBox" ? cfg.depthType : cfg.depthClick,
      semantic: !!control, burst: drag };
  });
  const grouped: Stage[] = [];
  for (const [index, stage] of stages.entries()) {
    const previous = grouped[grouped.length - 1];
    const lastClick = clicks[index - 1];
    if (previous && lastClick && stage.t - lastClick.t < cfg.panMs) {
      previous.rect = union(previous.rect, stage.rect); previous.depth = Math.min(previous.depth, stage.depth);
      previous.semantic ||= stage.semantic; previous.burst = true; previous.endT = stage.endT;
    } else grouped.push({ ...stage });
  }
  // Reserve the corridor of genuinely fast travel once, before the shot.
  // Ordinary hover movement still cannot change its depth or start a shot.
  const sweeps: { t: number; endT: number; rect: Rect }[] = [];
  for (let i = 1; i < positions.length; i++) {
    const a = positions[i - 1], b = positions[i];
    if (!a || !b || b.t <= a.t || b.t - a.t > 80) continue;
    if (Math.hypot((b.x - a.x) / ctx.source.w, (b.y - a.y) / ctx.source.h) * 1000 / (b.t - a.t) < 1) continue;
    const rect = union(padded({ x: a.x, y: a.y, w: 1, h: 1 }, ctx.source), padded({ x: b.x, y: b.y, w: 1, h: 1 }, ctx.source));
    const previous = sweeps[sweeps.length - 1];
    if (previous && a.t - previous.endT <= 60) { previous.endT = b.t; previous.rect = union(previous.rect, rect); }
    else sweeps.push({ t: a.t, endT: b.t, rect });
  }
  return segment => {
    const start = Math.max(0, segment.startMs), end = Math.min(ctx.durationMs, segment.endMs);
    const hasExit = segment.endMs < ctx.durationMs;
    const exitStart = hasExit ? Math.max(start, end - cfg.transitionOutMs) : end;
    const shotStages = grouped.filter(stage => stage.endT >= start && stage.t <= exitStart).map(stage => ({ ...stage, t: Math.max(start, stage.t) }));
    if (!shotStages.length || exitStart <= start) return [];
    for (const [index, stage] of shotStages.entries()) {
      if (stage.semantic) continue;
      const until = shotStages[index + 1]?.t ?? exitStart;
      const entranceEnd = Math.min(stage.t + cfg.transitionMs, until);
      const firstKey = keys[lower(keys, stage.t)];
      if (!firstKey || firstKey.t > entranceEnd) {
        // The entrance must cover ongoing activity, not arrive at a click
        // the pointer left a second ago. Reserve that travel before zooming.
        for (let i = lower(positions, stage.t); i < positions.length; i++) {
          const point = positions[i]; if (!point || point.t > entranceEnd) break;
          stage.rect = union(stage.rect, padded({ x: point.x, y: point.y, w: 1, h: 1 }, ctx.source));
        }
      }
      for (const sweep of sweeps) {
        if (sweep.t < stage.t || sweep.endT > until) continue;
        const keyIndex = lower(keys, sweep.t + 0.00001) - 1;
        if (keyIndex >= 0 && sweep.t - (keys[keyIndex]?.t ?? -Infinity) < 1200) continue;
        stage.rect = union(stage.rect, sweep.rect); stage.burst = true;
      }
    }
    const rest = screenRect(ctx.source, ctx.output, ctx.paddingFactor);
    // A rapid burst or drag earns one wider composition for the busy shot.
    // It cannot pump back in every time the pointer pauses for a few frames.
    const ceiling = shotStages.filter(stage => stage.burst).reduce((scale, stage) => Math.min(scale,
      fitContext(stage.rect, cfg.maxZoom, { cx: stage.rect.x + stage.rect.w / 2, cy: stage.rect.y + stage.rect.h / 2 }, ctx).scale), cfg.maxZoom);
    const result: ZoomKeyframe[] = [];
    const times = new Set<number>([start, exitStart]);
    for (let n = 1; start + n * STEP < exitStart; n++) times.add(start + n * STEP);
    for (const click of clicks) if (click.t >= start && click.t <= exitStart) times.add(click.t);
    let pose = rest, from = rest, target = rest;
    let stageIndex = -1, phaseStart = start, phaseDuration = cfg.transitionMs;
    let vx = 0, vy = 0, previousT = start;
    let shiftX = 0, shiftY = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      const next = shotStages[stageIndex + 1];
      if (next && t >= next.t) {
        stageIndex++; phaseStart = next.t; from = pose; vx = 0; vy = 0; shiftX = 0; shiftY = 0;
        const fit = fitContext(next.rect, Math.min(ceiling, 1 + next.depth * (cfg.maxZoom - 1)),
          { cx: next.rect.x + next.rect.w / 2, cy: next.rect.y + next.rect.h / 2 }, ctx);
        target = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, fit);
        phaseDuration = stageIndex === 0 || Math.abs(target.w - from.w) / rest.w > 0.01 ? cfg.transitionMs : cfg.panMs;
      }
      const current = shotStages[stageIndex];
      const dt = (t - previousT) / 1000;
      if (!current) pose = rest;
      else {
        // Depth pays the full configured transition while pan can already
        // follow travel during the entrance, rather than waiting 1.5 seconds.
        const composition = t < phaseStart + phaseDuration
          ? interpolateRect(from, target, EASINGS.cameraPan((t - phaseStart) / phaseDuration)) : target;
        const keyIndex = lower(keys, t + 0.00001) - 1;
        const typing = keyIndex >= 0 && t - (keys[keyIndex]?.t ?? -Infinity) < 1200;
        // The take is already recorded: short pan lookahead compensates for
        // input filtering and damping, without anticipating a zoom or click.
        const cursor = cursorAt(path, Math.min(t + 280, exitStart));
        const actual = cursorAt(rawPath, t);
        const ahead = cursorAt(path, Math.min(t + 320, exitStart));
        const behind = cursorAt(path, Math.min(t + 240, exitStart));
        let goal = { ...composition, x: composition.x + shiftX, y: composition.y + shiftY };
        if (!current.semantic && !typing && cursor) {
          const adjust = (pixel: number, offset: number, span: number, output: number) => {
            if (span <= output) return 0;
            const left = Math.max(0, offset), right = Math.min(output, offset + span), inset = (right - left) * 0.2;
            const frame = offset + pixel * span;
            return frame - clamp(frame, left + inset, right - inset);
          };
          goal = { ...goal,
            x: clamp(goal.x - adjust(cursor.x / ctx.source.w, goal.x, goal.w, ctx.output.w), Math.min(0, ctx.output.w - goal.w), Math.max(0, ctx.output.w - goal.w)),
            y: clamp(goal.y - adjust(cursor.y / ctx.source.h, goal.y, goal.h, ctx.output.h), Math.min(0, ctx.output.h - goal.h), Math.max(0, ctx.output.h - goal.h)) };
          // Anticipation must not pull the current pointer out of view when
          // a sweep stops or reverses direction.
          const contain = (offset: number, pixel: number, span: number, output: number) => {
            if (span <= output) return offset;
            const p = clamp(pixel, 0, 1), margin = Math.min(24, p * span, (1 - p) * span);
            return clamp(offset, Math.max(output - span, margin - p * span), Math.min(0, output - margin - p * span));
          };
          if (actual) goal = { ...goal,
            x: contain(goal.x, actual.x / ctx.source.w, goal.w, ctx.output.w),
            y: contain(goal.y, actual.y / ctx.source.h, goal.h, ctx.output.h) };
          shiftX = goal.x - composition.x; shiftY = goal.y - composition.y;
        }
        const release = hasExit ? ease((exitStart - t) / 350) : 1;
        const speed = (axis: "x" | "y", source: number, span: number, output: number) => Math.min(output * 3,
          Math.max(output * 0.6, ahead && behind ? Math.abs(ahead[axis] - behind[axis]) / source * span / 0.08 * 1.25 : 0,
            Math.abs(goal[axis] - pose[axis]) * 5));
        if (current.semantic) { pose = composition; vx = 0; vy = 0; }
        else {
          const x = damp(pose.x, vx, goal.x, dt * release, speed("x", ctx.source.w, goal.w, ctx.output.w), ctx.output.w * 5);
          const y = damp(pose.y, vy, goal.y, dt * release, speed("y", ctx.source.h, goal.h, ctx.output.h), ctx.output.h * 5);
          pose = { ...composition, x: x.value, y: y.value }; vx = x.velocity; vy = y.velocity;
        }
      }
      const scale = pose.w / rest.w;
      const authority = lateralAuthority(scale, ctx.paddingFactor);
      const coefficient = (scale - 1 / scale) * authority;
      result.push({ id: `${segment.id}a${result.length}`, tSourceMs: t, scale,
        cx: coefficient > 0.00001 ? 0.5 + ((ctx.output.w - pose.w) / 2 - pose.x) / (rest.w * coefficient) : 0.5,
        cy: coefficient > 0.00001 ? 0.5 + ((ctx.output.h - pose.h) / 2 - pose.y) / (rest.h * coefficient) : 0.5,
        quad: { ...pose }, cameraSample: true, easing: "linear", transitionMs: t - previousT, origin: segment.origin, pinned: segment.pinned });
      previousT = t;
    }
    if (hasExit) result.push({ id: `${segment.id}o`, tSourceMs: end, scale: 1, cx: 0.5, cy: 0.5,
      quad: rest, cameraSample: true, easing: "cameraPan", transitionMs: end - exitStart, origin: segment.origin, pinned: segment.pinned });
    return result;
  };
}

export function contextIsVisible(rect: Rect, focus: Focus, ctx: PlanContext): boolean {
  const quad = screenQuadFor(ctx.source, ctx.output, ctx.paddingFactor, focus);
  return quad.x + rect.x * quad.w >= -0.001 && quad.y + rect.y * quad.h >= -0.001
    && quad.x + (rect.x + rect.w) * quad.w <= ctx.output.w + 0.001
    && quad.y + (rect.y + rect.h) * quad.h <= ctx.output.h + 0.001;
}
