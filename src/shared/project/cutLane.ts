import { outputDurationMs, sourceSpanToOutput } from "./timeline";
import type { Cut } from "./types";

/** Removed material laid out at its seam, after every other cut's ripple. */
export function cutLaneSpan(cuts: Cut[], id: string, durationMs: number): {
  target: Cut; others: Cut[]; startMs: number; endMs: number; othersDurationMs: number;
} | null {
  const target = cuts.find(cut => cut.id === id);
  if (target === undefined) return null;
  const others = cuts.filter(cut => cut.id !== id);
  const span = sourceSpanToOutput(target.startMs, target.endMs, durationMs, others);
  return span === null ? null : { target, others, ...span, othersDurationMs: outputDurationMs(durationMs, others) };
}
