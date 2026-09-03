/**
 * Convert a source-timeline position into a position within one stream.
 *
 * `startOffsetMs` is how much LATER than the screen track this stream started,
 * so it is subtracted. Getting this sign backwards produces an export that
 * looks correct and drifts audio the wrong way — easy to ship, slow to
 * diagnose. Every stream seek goes through this function.
 */
export function toStreamLocalMs(
  tSourceMs: number,
  startOffsetMs: number,
  syncNudgeMs = 0,
): number {
  return tSourceMs - startOffsetMs + syncNudgeMs;
}
