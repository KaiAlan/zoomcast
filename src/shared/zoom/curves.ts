import type { EasingName } from "./types";

/**
 * The curves the inspector offers, in the order it shows them.
 *
 * `cameraZoom` first: it is the default, and a picker that cannot show the
 * default renders the first option instead and turns every change into a
 * one-way trip. `linear` and `cameraPan` are deliberately absent — they are
 * mechanisms (the follow sampler's ramp, the in-shot pan), not looks anyone
 * would choose for a zoom. See easing.ts for what each curve measured as.
 */
export const CURVES: ReadonlyArray<{ value: EasingName; label: string }> = [
  { value: "cameraZoom", label: "camera — quick push, soft settle" },
  { value: "screenStudio", label: "studio — commits, then settles" },
  { value: "zoomGlide", label: "glide — even, peaks mid-move" },
  { value: "zoomEase", label: "ease — fast in, drifting tail" },
];
