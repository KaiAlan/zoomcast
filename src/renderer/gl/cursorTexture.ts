import type { CursorShape } from "../../shared/bundle/types";
import { CURSOR_SHAPES } from "../../shared/cursor/shapes";

/** Extra margin around the glyph so the stroke and shadow are not clipped. */
const PAD = 4;

/**
 * Rasterises a vector cursor once per (shape, size) and keeps the texture.
 *
 * Re-rasterising rather than scaling one bitmap is the point: the cursor has
 * to stay sharp when the camera is zoomed and when the export is 4K.
 */
export class CursorTextureCache {
  private readonly cache = new Map<string, WebGLTexture>();

  get(gl: WebGL2RenderingContext, shape: CursorShape, sizePx: number): WebGLTexture {
    const px = Math.max(8, Math.round(sizePx));
    const key = `${shape}@${px}`;
    const held = this.cache.get(key);
    if (held !== undefined) return held;

    const art = CURSOR_SHAPES[shape];
    const scale = px / art.viewBox;
    const dim = px + PAD * 2;

    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;

    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("could not get 2d context for cursor");

    ctx.translate(PAD, PAD);
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

    this.cache.set(key, tex);
    return tex;
  }
}
