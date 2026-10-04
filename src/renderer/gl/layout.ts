import { screenQuadFor } from "../../shared/zoom/viewport";
import type { Rect } from "../../shared/zoom/geometry";
import type { ZoomState } from "../../shared/zoom/interpolate";
import type { Size } from "../../shared/zoom/types";

/**
 * Where the recording is drawn, for a zoom. The window GROWS and travels.
 *
 * A thin delegate: the arithmetic lives in `src/shared/zoom/viewport.ts`
 * because `clampToSource` needs the same clamp and `src/shared/` cannot import
 * from the renderer. Two copies would be free to disagree, and the one the
 * renderer draws with is the one that decides what is on screen.
 */
export function screenQuad(
  source: Size,
  output: Size,
  paddingFactor: number,
  zoom: ZoomState,
): Rect {
  return screenQuadFor(source, output, paddingFactor, zoom);
}
