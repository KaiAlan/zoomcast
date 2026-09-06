import { clamp, screenRect, type Rect } from "../../shared/zoom/geometry";
import type { ZoomState } from "../../shared/zoom/interpolate";
import type { Size } from "../../shared/zoom/types";

/**
 * Place the screen quad in output space for a given zoom state.
 *
 * Scale about the focus point, then pull the focus toward the output centre by
 * k = 1 - 1/scale. k is 0 at scale 1, so this reduces exactly to screenRect and
 * has no discontinuity when a zoom begins; as scale grows k approaches 1 and
 * the subject ends up centred.
 *
 * Pure by design and unit-tested — only Renderer.ts touches WebGL.
 */
export function screenQuad(
  source: Size,
  output: Size,
  paddingFactor: number,
  zoom: ZoomState,
): Rect {
  const base = screenRect(source, output, paddingFactor);

  const w = base.w * zoom.scale;
  const h = base.h * zoom.scale;

  const focusX = base.x + zoom.cx * base.w;
  const focusY = base.y + zoom.cy * base.h;

  const k = 1 - 1 / zoom.scale;

  let x = focusX - zoom.cx * w + (output.w / 2 - focusX) * k;
  let y = focusY - zoom.cy * h + (output.h / 2 - focusY) * k;

  // Keep the quad and the frame nested, whichever of the two is larger: below
  // the crossover this reads as "keep the quad inside the frame", above it as
  // "never let an edge reveal background".
  //
  // Both bounds must be written as ONE continuous range. Gating on
  // `w >= output.w` instead makes the range [output.w - w, 0] collapse to zero
  // width at exactly w === output.w, pinning x to 0 there while the unclamped x
  // is hundreds of pixels away — and one float below the crossover the clamp
  // released and the camera teleported. That crossover sits at scale
  // 1 / paddingFactor, which is exactly where maxComfortableZoom lands whenever
  // output matches source, so every zoom reaching the ceiling jumped on its way
  // out. Measured at 229px on take 2026-09-05T13-13-31. The continuity
  // properties in layout.test.ts are what hold this closed.
  x = clamp(x, Math.min(0, output.w - w), Math.max(0, output.w - w));
  y = clamp(y, Math.min(0, output.h - h), Math.max(0, output.h - h));

  return { x, y, w, h };
}
