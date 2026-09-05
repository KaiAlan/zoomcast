import type { CursorShape } from "../../shared/bundle/types";
import { CURSOR_SHAPES } from "../../shared/cursor/shapes";

/**
 * Extra margin around the glyph so the stroke and shadow are not clipped.
 *
 * Proportional, not fixed: the stroke is 3 path units wide, which is
 * 1.5 * px/32 device pixels at the half-width, and `arrow`'s hotspot sits at
 * viewBox (0,0) — the exact texture corner — so its round join runs past a
 * fixed 4px margin once px is much above 85. That is reachable at 4K export.
 */
export function padFor(px: number): number {
  return Math.max(4, Math.ceil(px * 0.0625));
}

/**
 * Bounds on the rasterised glyph, in device pixels.
 *
 * The floor keeps a cursor visible; the ceiling is the real point. Nothing
 * upstream bounds the requested size — the inspector deliberately does not
 * validate — so without this a typed 10000 asks for a texture past
 * MAX_TEXTURE_SIZE, texImage2D fails with INVALID_VALUE, and the broken entry
 * is CACHED, so it never heals. Well before that a fat-fingered extra zero
 * costs multiple megabytes per shape.
 */
export const MIN_CURSOR_PX = 8;
export const MAX_CURSOR_PX = 512;

/**
 * A rasterised cursor and the size it was actually rasterised at.
 *
 * `px` is the clamped, rounded size — never the raw `sizePx` a caller asked
 * for. Screen-space geometry (the hotspot offset, the drawn quad) must be
 * derived from `px`, not re-requested from the caller's raw value, or the
 * hotspot's fraction of the quad stops matching its fraction of the texture.
 */
export type CursorTexture = { texture: WebGLTexture; px: number };

/**
 * Rasterises a vector cursor once per (shape, size) and keeps the texture.
 *
 * Re-rasterising rather than scaling one bitmap is the point: the cursor has
 * to stay sharp when the camera is zoomed and when the export is 4K.
 */
export class CursorTextureCache {
  private readonly cache = new Map<string, CursorTexture>();

  get(gl: WebGL2RenderingContext, shape: CursorShape, sizePx: number): CursorTexture {
    const px = Math.min(MAX_CURSOR_PX, Math.max(MIN_CURSOR_PX, Math.round(sizePx)));
    const key = `${shape}@${px}`;
    const held = this.cache.get(key);
    if (held !== undefined) return held;

    const art = CURSOR_SHAPES[shape];
    const scale = px / art.viewBox;
    const pad = padFor(px);
    const dim = px + pad * 2;

    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;

    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("could not get 2d context for cursor");

    ctx.translate(pad, pad);
    ctx.scale(scale, scale);

    const path = new Path2D(art.path);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.stroke(path);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path);

    const tex = gl.createTexture();
    if (tex === null) throw new Error("could not create cursor texture");

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const entry: CursorTexture = { texture: tex, px };
    this.cache.set(key, entry);
    return entry;
  }

  /** Releases every rasterised texture. Call once, from the owning Renderer's dispose. */
  dispose(gl: WebGL2RenderingContext): void {
    for (const { texture } of this.cache.values()) gl.deleteTexture(texture);
    this.cache.clear();
  }
}
