/**
 * The depth presets `SegmentPopover` offers, and the pure matching logic
 * behind them.
 *
 * Split out of `SegmentPopover.tsx` for one reason: this repo's vitest suite
 * has no React harness, so nothing in a `.tsx` file is ever exercised by a
 * test. `activeDepthPresetIndex` is genuinely pure -- a depth and a preset
 * list in, an index out -- so it belongs here, where it can be tested, and
 * `SegmentPopover.tsx` re-exports `DEPTH_PRESETS` from this module rather
 * than declaring its own copy.
 */

/** Fractions of `maxZoom`, from the shallowest offered depth to the deepest. */
export const DEPTH_PRESETS = [0.25, 0.4, 0.55, 0.7, 0.85, 1] as const;

/**
 * How close a segment's depth must sit to a preset to read as "on" that
 * preset, rather than as a value the user (or the planner) chose freely.
 *
 * Loose enough to absorb float drift from a round trip through the project's
 * JSON, tight enough that an auto-planned depth (0.917 for a click, 0.583 for
 * typing, 0.25 for scroll) still reads as unmatched where it should.
 */
const PRESET_TOLERANCE = 0.001;

/**
 * The index into `presets` that `depth` matches within `PRESET_TOLERANCE`, or
 * -1 when it matches none. An auto-planned segment usually returns -1, which
 * is the honest answer: it was never set to a preset.
 */
export function activeDepthPresetIndex(
  depth: number,
  presets: readonly number[] = DEPTH_PRESETS,
): number {
  return presets.findIndex((preset) => Math.abs(preset - depth) <= PRESET_TOLERANCE);
}
