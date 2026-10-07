import type { TelemetryEvent } from "../bundle/types";
import type { CursorStyle, Cut } from "../project/types";
import { outputDurationMs, outputToSource } from "../project/timeline";
import { cursorAt, type CursorPath, type CursorSample } from "./path";

export type CursorEffects = {
  scale: number;
  angleRad: number;
  /** Shutter displacement in source pixels; the renderer maps it to output. */
  blurX: number;
  blurY: number;
};

export type CursorFrame = { sample: CursorSample; effects: CursorEffects };
export type CursorTiming = { durationMs: number; cuts: Cut[]; outputMs: number; fps: number };
const GRID_MS = 1000 / 60;
const smoothstep = (p: number): number => p * p * (3 - 2 * p);

/** Stateless sampling keeps seeks, playback and export identical at a given time. */
export function cursorFrameAt(
  path: CursorPath | null,
  clicks: TelemetryEvent[],
  sourceMs: number,
  style: CursorStyle,
  timing: CursorTiming,
): CursorFrame | null {
  if (!path || path.xs.length === 0) return null;
  const duration = outputDurationMs(timing.durationMs, timing.cuts);
  const lastFrameMs = Math.max(0, (Math.floor(duration * timing.fps / 1000) - 1) * 1000 / timing.fps);
  const returnMs = Math.min(600, lastFrameMs / 2);
  const firstSourceMs = outputToSource(0, timing.durationMs, timing.cuts);
  const first = cursorAt(path, Math.max(path.t0, firstSourceMs));
  const loopWeight = style.loop && returnMs > 0 && first
    ? smoothstep(Math.min(1, Math.max(0, (timing.outputMs - (lastFrameMs - returnMs)) / returnMs))) : 0;
  const sampleAt = (t: number, outputMs: number): CursorSample | null => {
    // Older captures logged coordinates only after the first movement. Hold
    // that first known position through the lead-in so styles are visible on
    // the opening frame too. An entirely empty position stream still returns null.
    const s = cursorAt(path, Math.max(path.t0, t));
    if (!s || !first || !style.loop || returnMs <= 0) return s;
    const w = smoothstep(Math.min(1, Math.max(0, (outputMs - (lastFrameMs - returnMs)) / returnMs)));
    return { x: s.x + (first.x - s.x) * w, y: s.y + (first.y - s.y) * w, shape: w >= 0.5 ? first.shape : s.shape };
  };
  const sample = sampleAt(sourceMs, timing.outputMs);
  if (!sample) return null;
  // Never smear across a cut: those source positions were not adjacent on screen.
  const previousSource = outputToSource(Math.max(0, timing.outputMs - GRID_MS), timing.durationMs, timing.cuts);
  const previous = sourceMs - previousSource > GRID_MS + 0.01 ? sample : sampleAt(previousSource, Math.max(0, timing.outputMs - GRID_MS)) ?? sample;
  const dx = sample.x - previous.x;
  const dy = sample.y - previous.y;
  let scale = 1;
  if (style.clickBounce > 0) {
    // clicks is sorted and prefiltered by both callers; binary search avoids
    // walking the entire recording for every export frame.
    let lo = 0; let hi = clicks.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if ((clicks[mid]?.t ?? Infinity) <= sourceMs) lo = mid + 1; else hi = mid; }
    const click = clicks[lo - 1];
    if (click?.k === "down") {
      const age = sourceMs - click.t;
      const outputClick = timing.outputMs - age;
      const actualClickSource = outputToSource(Math.max(0, outputClick), timing.durationMs, timing.cuts);
      if (age < style.bounceDurationMs && Math.abs(actualClickSource - click.t) < 0.01) {
        const p = age / style.bounceDurationMs;
        scale += style.clickBounce * (-0.08 * Math.sin(Math.PI * p) + 0.06 * Math.sin(2 * Math.PI * p)) * (1 - loopWeight);
      }
    }
  }
  return {
    sample,
    effects: {
      scale,
      angleRad: Math.max(-0.5, Math.min(0.5, dx / 80)) * style.sway * (1 - loopWeight) || 0,
      blurX: dx * style.motionBlur * (1 - loopWeight) || 0,
      blurY: dy * style.motionBlur * (1 - loopWeight) || 0,
    },
  };
}
