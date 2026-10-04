import type { AspectChoice, OutputConfig } from "../project/types";
import type { Size } from "../zoom/types";

export const ASPECT_RATIOS: Record<Exclude<AspectChoice, "native">, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16,
};

/**
 * H.264 requires even width and height; an odd dimension fails the encoder
 * outright. Floored at 2 so a zeroed or corrupt config still produces a
 * renderable size rather than a division by zero downstream.
 */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * The size a project renders and exports at.
 *
 * "native" honours the explicit width and height, which is how an export
 * resolution gets chosen. A named aspect keeps the configured HEIGHT and
 * derives the width, so switching aspect changes the frame's shape without
 * quietly changing how much detail is in it.
 *
 * `source` is unused today. It is in the signature because "native" should
 * eventually follow a non-1080p recording rather than a stored constant, and a
 * later caller passing it should not be a signature change.
 */
export function outputSizeFor(output: OutputConfig, source: Size): Size {
  void source;

  if (output.aspect === "native") {
    return { w: even(output.width), h: even(output.height) };
  }

  const h = even(output.height);
  return { w: even(h * ASPECT_RATIOS[output.aspect]), h };
}
