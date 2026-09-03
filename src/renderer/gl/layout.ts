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

  // Once the quad is larger than the frame, never let an edge reveal background.
  if (w >= output.w) x = clamp(x, output.w - w, 0);
  if (h >= output.h) y = clamp(y, output.h - h, 0);

  return { x, y, w, h };
}
