import type { Settings } from "./types";

/**
 * 60 by default.
 *
 * It is what the panel runs at, it is what makes camera motion look smooth,
 * and gdigrab delivers about 44fps when asked for it against about 27 when
 * asked for 30. 30 stays available because the extra frames cost file size and
 * CPU on a path that is already CPU-bound.
 */
export function defaultSettings(): Settings {
  return { captureFps: 60 };
}
