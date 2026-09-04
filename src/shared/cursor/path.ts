import type { CursorShape, TelemetryEvent } from "../bundle/types";

export type PathOptions = {
  /** 0 = raw telemetry, 1 = heavily damped. */
  smoothing: number;
  sampleHz: number;
};

export type CursorSample = {
  x: number;
  y: number;
  shape: CursorShape;
  pressed: boolean;
};

export type CursorPath = {
  t0: number;
  stepMs: number;
  xs: Float32Array;
  ys: Float32Array;
  shapes: CursorShape[];
  pressed: Uint8Array;
};

/** Half-life of the lag, in ms, at the two ends of the smoothing range. */
const MIN_HALF_LIFE_MS = 0;
const MAX_HALF_LIFE_MS = 90;

/**
 * Precompute the drawn cursor path.
 *
 * An exponential (one-pole) lag toward the latest telemetry target, evaluated
 * on a fixed grid rather than per frame. This is not a critically damped
 * spring — there is no velocity state, only position chasing target — and
 * that is deliberate: memoryless exponential decay composes exactly across
 * step sizes (two half-steps of decay equal one full step), so the same
 * telemetry produces the same path regardless of grid rate. A true spring's
 * velocity state does not compose that way. Evaluating on a fixed grid
 * matters for the same reason at a coarser level: per-frame integration would
 * depend on frame timing, so a 60fps preview and a 30fps export would
 * produce different paths and verify:parity would be right to fail. On a
 * fixed grid the path is a pure function of telemetry and config, identical
 * in both.
 */
export function buildCursorPath(
  events: TelemetryEvent[],
  opts: PathOptions,
): CursorPath {
  const stepMs = 1000 / opts.sampleHz;
  const moves = events.filter(
    (e) => e.k === "move" || e.k === "down" || e.k === "up" || e.k === "wheel",
  );
  const first = moves[0];

  if (first === undefined || !("x" in first)) {
    return {
      t0: 0,
      stepMs,
      xs: new Float32Array(0),
      ys: new Float32Array(0),
      shapes: [],
      pressed: new Uint8Array(0),
    };
  }

  const last = events[events.length - 1];
  const t0 = first.t;
  const tEnd = last === undefined ? t0 : last.t;
  const count = Math.max(1, Math.ceil((tEnd - t0) / stepMs) + 1);

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const shapes: CursorShape[] = new Array<CursorShape>(count);
  const pressed = new Uint8Array(count);

  // Half-life form, so the response is frame-rate independent by construction.
  const halfLife =
    MIN_HALF_LIFE_MS + (MAX_HALF_LIFE_MS - MIN_HALF_LIFE_MS) * clamp01(opts.smoothing);
  const decay = halfLife <= 0 ? 0 : Math.pow(0.5, stepMs / halfLife);

  let x = first.x;
  let y = first.y;
  let targetX = first.x;
  let targetY = first.y;
  let shape: CursorShape = "arrow";
  let down = false;
  let cursor = 0;

  for (let i = 0; i < count; i++) {
    const t = t0 + i * stepMs;

    while (cursor < events.length && (events[cursor] as TelemetryEvent).t <= t) {
      const e = events[cursor] as TelemetryEvent;
      if (e.k === "move" || e.k === "down" || e.k === "up" || e.k === "wheel") {
        targetX = e.x;
        targetY = e.y;
      }
      if (e.k === "down") down = true;
      if (e.k === "up") down = false;
      if (e.k === "cursor") shape = e.shape;
      cursor++;
    }

    x = targetX + (x - targetX) * decay;
    y = targetY + (y - targetY) * decay;

    xs[i] = x;
    ys[i] = y;
    shapes[i] = shape;
    pressed[i] = down ? 1 : 0;
  }

  return { t0, stepMs, xs, ys, shapes, pressed };
}

export function cursorAt(path: CursorPath, tMs: number): CursorSample | null {
  if (path.xs.length === 0 || tMs < path.t0) return null;

  const i = Math.min(path.xs.length - 1, Math.round((tMs - path.t0) / path.stepMs));

  return {
    x: path.xs[i] as number,
    y: path.ys[i] as number,
    shape: path.shapes[i] ?? "arrow",
    pressed: path.pressed[i] === 1,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
