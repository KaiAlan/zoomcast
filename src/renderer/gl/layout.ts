import { screenRect, type Rect } from "../../shared/zoom/geometry";
import type { Size } from "../../shared/zoom/types";

/**
 * The frame the recording is drawn into. NOT a function of zoom.
 *
 * Zoom used to scale this rectangle until the output cropped it, which meant
 * the whole zoom range was 1/paddingFactor — the factor at which the growing
 * frame exactly filled the output — and the camera had no freedom at all at
 * the top of it, because the quad covered the output and cx/cy clamped to dead
 * centre. That is why the result read as the screen being scaled rather than a
 * camera moving.
 *
 * The camera is now `sourceRectFor` in src/shared/zoom/viewport.ts: the region
 * SAMPLED into this frame. The frame is presentation; the sampled region is
 * the camera. See docs/specs/2026-09-07-camera-geometry-and-depth-design.md.
 */
export function screenQuad(source: Size, output: Size, paddingFactor: number): Rect {
  return screenRect(source, output, paddingFactor);
}
