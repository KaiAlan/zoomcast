import type { TelemetryEvent } from "../bundle/types";

export type Ripple = { x: number; y: number; progress: number };

/**
 * Expanding rings at recent clicks.
 *
 * Recomputed per frame from the event list rather than simulated, for the same
 * reason the cursor path is precomputed: it must not depend on frame timing,
 * or preview and export would disagree.
 */
export function ripplesAt(
  events: TelemetryEvent[],
  tMs: number,
  durationMs: number,
): Ripple[] {
  const out: Ripple[] = [];

  for (const e of events) {
    if (e.k !== "down") continue;
    if (e.t > tMs) break;

    const age = tMs - e.t;
    if (age >= durationMs) continue;

    out.push({ x: e.x, y: e.y, progress: age / durationMs });
  }

  return out;
}
