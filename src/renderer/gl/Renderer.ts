import type { CursorSample } from "../../shared/cursor/path";
import type { Ripple } from "../../shared/cursor/ripples";
import { CURSOR_SHAPES } from "../../shared/cursor/shapes";
import type { CursorStyle, StyleConfig } from "../../shared/project/types";
import type { ZoomState } from "../../shared/zoom/interpolate";
import type { Size } from "../../shared/zoom/types";
import {
  BLUR_LOD,
  MESH_POINTS,
  gradientPreset,
} from "../../shared/style/backgrounds";
import { hexToRgb, hexToRgba } from "../../shared/style/color";
import { resolveFrame } from "../../shared/style/frame";
import { BackgroundTextureCache } from "./backgroundTexture";
import { CursorTextureCache, padFor } from "./cursorTexture";
import { screenQuad } from "./layout";
import { WHOLE_SOURCE, sourceToFrame, type SourceRect } from "../../shared/zoom/viewport";
import {
  BG_FRAG,
  CURSOR_FRAG,
  QUAD_VERT,
  RIPPLE_FRAG,
  SCREEN_FRAG,
  SHADOW_FRAG,
} from "./shaders";

export type FrameState = {
  screen: TexImageSource;
  webcam?: TexImageSource;
  zoom: ZoomState;
  style: StyleConfig;
  outputSize: Size;
  sourceSize: Size;
  cursor?: { sample: CursorSample; style: CursorStyle };
  ripples?: Ripple[];
  /**
   * Fully-resolved zc:// URL of the background image, when the style selects
   * one. Built by the caller rather than here, because turning a project dir
   * plus a basename into a URL is renderer-shell knowledge, and a file:// URL
   * cannot be fetched from the custom scheme at all.
   */
  backgroundImageUrl?: string;
};

type ResolvedFrame = ReturnType<typeof resolveFrame>;

type Program = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

const MAX_SHARPEN = 0.6;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("could not create shader");

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }

  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  fragSrc: string,
  names: string[],
): Program {
  const program = gl.createProgram();
  if (program === null) throw new Error("could not create program");

  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    throw new Error(`program link failed: ${log}`);
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of [...names, "u_rect"]) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  return { program, uniforms };
}

/**
 * The single compositor. Preview and export both call `drawFrame`, which is
 * what makes "what you see is what you get" a structural property rather than
 * a thing to stay disciplined about.
 */
export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly bg: Program;
  private readonly shadow: Program;
  private readonly screen: Program;
  private readonly cursorProgram: Program;
  private readonly rippleProgram: Program;
  private readonly cursorTextures = new CursorTextureCache();
  private readonly backgroundTextures = new BackgroundTextureCache();
  private readonly tex: WebGLTexture;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;

    if (gl === null) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (vao === null || buffer === null) throw new Error("could not create buffers");

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;

    // Array uniforms are looked up per element, never as a block: asking for
    // "u_points" alone returns null and every point silently stays at zero.
    const bgUniforms = [
      "u_mode",
      "u_color",
      "u_falloff",
      "u_aspect",
      "u_lod",
      "u_image",
      "u_imageScale",
    ];
    for (let i = 0; i < MESH_POINTS; i++) {
      bgUniforms.push(`u_points[${i}]`, `u_colors[${i}]`);
    }
    this.bg = link(gl, BG_FRAG, bgUniforms);
    this.shadow = link(gl, SHADOW_FRAG, [
      "u_spanPx",
      "u_halfPx",
      "u_radiusPx",
      "u_blurPx",
      "u_opacity",
    ]);
    this.screen = link(gl, SCREEN_FRAG, [
      "u_tex",
      "u_quadPx",
      "u_uv0",
      "u_uv1",
      "u_radiusPx",
      "u_sharpen",
      "u_texel",
      "u_borderPx",
      "u_borderColor",
    ]);
    this.cursorProgram = link(gl, CURSOR_FRAG, ["u_tex", "u_shadow"]);
    this.rippleProgram = link(gl, RIPPLE_FRAG, ["u_progress"]);

    const tex = gl.createTexture();
    if (tex === null) throw new Error("could not create texture");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = tex;

    // No UNPACK_FLIP_Y_WEBGL: WebGL already uploads the image's top row at
    // t=0, and the vertex shader does the one Y flip into clip space. Setting
    // the unpack flip as well flips twice and renders the frame upside down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  drawFrame(state: FrameState): void {
    const gl = this.gl;
    const { outputSize: out, sourceSize: src, style } = state;

    if (this.canvas.width !== out.w || this.canvas.height !== out.h) {
      this.canvas.width = out.w;
      this.canvas.height = out.h;
    }

    gl.viewport(0, 0, out.w, out.h);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);

    this.drawBackground(style, out, state.backgroundImageUrl);

    // The zoom is in the quad now: the window grows and travels, and the
    // shader samples the whole recording into it. `region` stays in the
    // signature because the cursor and ripples map through the same one
    // function as the screen (invariant 5) — it is simply total.
    const quad = screenQuad(src, out, style.paddingFactor, state.zoom);
    const region = WHOLE_SOURCE;

    // Resolved once: every frame read must go through this or the presets
    // silently do nothing.
    const frame = resolveFrame(style.frame);

    this.drawShadow(quad, out, frame);
    this.drawScreen(quad, region, out, src, frame, state.screen);

    // Ripples are their own toggle, independent of cursor visibility: a click
    // near the ends of the path can outlive the cursor sample that produced
    // it (cursorAt returns null there), and `visible: false` should not mute
    // a separately-enabled ripple.
    if (style.cursor.ripples) {
      this.withFrameClip(quad, out, () =>
        this.drawRipples(state.ripples ?? [], quad, region, out, src),
      );
    }

    if (state.cursor !== undefined && state.cursor.style.visible) {
      const cursor = state.cursor;
      this.withFrameClip(quad, out, () =>
        this.drawCursor(cursor.sample, cursor.style, quad, region, out, src),
      );
    }

    gl.bindVertexArray(null);
  }

  /**
   * Run `draw` with rendering clipped to the frame.
   *
   * The ONE place a bottom-left origin appears: gl.scissor measures from the
   * bottom of the drawing buffer while every coordinate in this codebase
   * measures from the top (invariant 10). Confining the flip here is what
   * keeps that invariant true everywhere else.
   *
   * Needed because the frame no longer grows to the output edge, so there is
   * nothing else to crop an overlay that overhangs it — a cursor whose anchor
   * is just inside the sampled region can still draw its glyph over the
   * background.
   *
   * The scissor box is rectangular and the frame has rounded corners, so an
   * overlay can still show over a corner's cut. At a 12px radius that is a few
   * pixels in the extreme corners; accepted rather than masked.
   */
  private withFrameClip(
    quad: { x: number; y: number; w: number; h: number },
    out: Size,
    draw: () => void,
  ): void {
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.floor(quad.x),
      Math.floor(out.h - (quad.y + quad.h)),
      Math.ceil(quad.w),
      Math.ceil(quad.h),
    );
    try {
      draw();
    } finally {
      gl.disable(gl.SCISSOR_TEST);
    }
  }

  private setRect(
    p: Program,
    x: number,
    y: number,
    w: number,
    h: number,
    out: Size,
  ): void {
    this.gl.uniform4f(
      p.uniforms.u_rect ?? null,
      x / out.w,
      y / out.h,
      w / out.w,
      h / out.h,
    );
  }

  private drawBackground(style: StyleConfig, out: Size, imageUrl?: string): void {
    const gl = this.gl;
    const bg = style.background;

    // "hidden" is a flat black ground, which is what an export wants when the
    // result is going to be composited downstream.
    if (bg.kind === "hidden") {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.useProgram(this.bg.program);
    gl.uniform4f(this.bg.uniforms.u_rect ?? null, 0, 0, 1, 1);

    if (bg.kind === "image" && imageUrl !== undefined) {
      const tex = this.backgroundTextures.get(gl, imageUrl);
      const size = this.backgroundTextures.sizeOf(imageUrl);

      if (tex !== null && size !== null) {
        // Cover fit, expressed as a scale on the sampling coordinate about the
        // centre: scaling UP the coordinate crops, so the axis that is
        // relatively too LARGE gets the >1 factor. Fills the frame on both
        // axes, crops the overflow, never letterboxes.
        const imageAspect = size.w / size.h;
        const outAspect = out.w / out.h;
        const sx = imageAspect > outAspect ? outAspect / imageAspect : 1;
        const sy = imageAspect > outAspect ? 1 : imageAspect / outAspect;

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(this.bg.uniforms.u_image ?? null, 1);
        gl.uniform2f(this.bg.uniforms.u_imageScale ?? null, sx, sy);
        // Blur is image-only: on a mesh it is a measured no-op.
        gl.uniform1f(this.bg.uniforms.u_lod ?? null, BLUR_LOD[bg.blur]);
        gl.uniform1i(this.bg.uniforms.u_mode ?? null, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      // Falls through to the solid colour while the image decodes, or forever
      // if it failed to load.
    }

    if (bg.kind === "color" || bg.kind === "image") {
      const [r, g, b] = hexToRgb(bg.color);
      gl.uniform1i(this.bg.uniforms.u_mode ?? null, 1);
      gl.uniform3f(this.bg.uniforms.u_color ?? null, r, g, b);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    const preset = gradientPreset(bg.preset);
    gl.uniform1i(this.bg.uniforms.u_mode ?? null, 0);
    gl.uniform1f(this.bg.uniforms.u_falloff ?? null, preset.falloff);
    gl.uniform1f(this.bg.uniforms.u_aspect ?? null, out.w / out.h);

    preset.points.forEach((pt, i) => {
      const [r, g, b] = hexToRgb(pt.color);
      gl.uniform2f(this.bg.uniforms[`u_points[${i}]`] ?? null, pt.x, pt.y);
      gl.uniform3f(this.bg.uniforms[`u_colors[${i}]`] ?? null, r, g, b);
    });

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawShadow(
    quad: { x: number; y: number; w: number; h: number },
    out: Size,
    frame: ResolvedFrame,
  ): void {
    const gl = this.gl;
    const { blurPx, opacity, offsetYPx } = frame.shadow;
    if (opacity <= 0) return;

    const pad = blurPx * 2;
    const spanW = quad.w + pad * 2;
    const spanH = quad.h + pad * 2;

    gl.useProgram(this.shadow.program);
    gl.uniform2f(this.shadow.uniforms.u_spanPx ?? null, spanW, spanH);
    gl.uniform2f(this.shadow.uniforms.u_halfPx ?? null, quad.w / 2, quad.h / 2);
    gl.uniform1f(this.shadow.uniforms.u_radiusPx ?? null, frame.cornerRadiusPx);
    gl.uniform1f(this.shadow.uniforms.u_blurPx ?? null, Math.max(blurPx, 1));
    gl.uniform1f(this.shadow.uniforms.u_opacity ?? null, opacity);

    this.setRect(
      this.shadow,
      quad.x - pad,
      quad.y - pad + offsetYPx,
      spanW,
      spanH,
      out,
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawScreen(
    quad: { x: number; y: number; w: number; h: number },
    region: SourceRect,
    out: Size,
    src: Size,
    frame: ResolvedFrame,
    source: TexImageSource,
  ): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // Sharpen only where we are actually upscaling past 1:1. That now depends
    // on how much of the source is sampled, not on the quad's size — the quad
    // does not change any more.
    const sampleScale = quad.w / (src.w * region.w);
    const sharpen = sampleScale > 1 ? Math.min(MAX_SHARPEN, sampleScale - 1) : 0;

    gl.useProgram(this.screen.program);
    gl.uniform1i(this.screen.uniforms.u_tex ?? null, 0);
    gl.uniform2f(this.screen.uniforms.u_quadPx ?? null, quad.w, quad.h);
    gl.uniform1f(this.screen.uniforms.u_radiusPx ?? null, frame.cornerRadiusPx);

    const borderPx = frame.border.visible ? frame.border.widthPx : 0;
    const [br, bg2, bb, ba] = hexToRgba(frame.border.color);
    gl.uniform1f(this.screen.uniforms.u_borderPx ?? null, borderPx);
    gl.uniform4f(this.screen.uniforms.u_borderColor ?? null, br, bg2, bb, ba);
    gl.uniform1f(this.screen.uniforms.u_sharpen ?? null, sharpen);
    gl.uniform2f(this.screen.uniforms.u_texel ?? null, 1 / src.w, 1 / src.h);
    gl.uniform2f(this.screen.uniforms.u_uv0 ?? null, region.x, region.y);
    gl.uniform2f(
      this.screen.uniforms.u_uv1 ?? null,
      region.x + region.w,
      region.y + region.h,
    );

    this.setRect(this.screen, quad.x, quad.y, quad.w, quad.h, out);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Draw expanding click rings, one quad per active ripple, in output space.
   *
   * Position maps through the same quad as the cursor, so rings track the
   * zoom the same way. Drawn before the cursor so the cursor sits on top.
   */
  private drawRipples(
    ripples: Ripple[],
    quad: { x: number; y: number; w: number; h: number },
    region: SourceRect,
    out: Size,
    src: Size,
  ): void {
    const gl = this.gl;
    if (ripples.length === 0) return;

    // Deliberately independent of cursor.sizePct: the ring marks the click, not
    // the glyph, so it keeps one size however large the cursor is drawn.
    const size = (out.h / 1080) * 96;
    gl.useProgram(this.rippleProgram.program);

    for (const r of ripples) {
      const at = sourceToFrame({ x: r.x / src.w, y: r.y / src.h }, region, quad);
      if (at === null) continue;
      const { x, y } = at;

      gl.uniform1f(this.rippleProgram.uniforms.u_progress ?? null, r.progress);
      this.setRect(this.rippleProgram, x - size / 2, y - size / 2, size, size, out);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /**
   * Draw the cursor in output space.
   *
   * The position is mapped through the same quad the screen was drawn into, so
   * the cursor tracks the zoom — but the SIZE is not scaled by the zoom, so its
   * apparent size stays constant. A cursor that grows as the camera pushes in
   * reads as a bug.
   */
  private drawCursor(
    sample: CursorSample,
    style: CursorStyle,
    quad: { x: number; y: number; w: number; h: number },
    region: SourceRect,
    out: Size,
    src: Size,
  ): void {
    const gl = this.gl;
    const art = CURSOR_SHAPES[sample.shape];

    const sizePx = (out.h / 1080) * 24 * (style.sizePct / 100);
    const cursorTex = this.cursorTextures.get(gl, sample.shape, sizePx);
    // Geometry derives from cursorTex.px — the clamped, rounded size the
    // cache actually rasterised — not the raw sizePx, so the hotspot's
    // fraction of the drawn quad matches its fraction of the texture.
    // Same px and the same pad the cache actually rasterised with: geometry
    // recomputed from anything else puts the hotspot off the click point.
    const pad = padFor(cursorTex.px);
    const dim = cursorTex.px + pad * 2;

    const at = sourceToFrame({ x: sample.x / src.w, y: sample.y / src.h }, region, quad);
    if (at === null) return;
    const { x, y } = at;

    const hotX = (art.hotspot.x / art.viewBox) * cursorTex.px + pad;
    const hotY = (art.hotspot.y / art.viewBox) * cursorTex.px + pad;

    gl.useProgram(this.cursorProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cursorTex.texture);
    gl.uniform1i(this.cursorProgram.uniforms.u_tex ?? null, 0);
    gl.uniform1f(this.cursorProgram.uniforms.u_shadow ?? null, style.shadow ? 1 : 0);

    this.setRect(this.cursorProgram, x - hotX, y - hotY, dim, dim, out);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Decode a background image before rendering starts.
   *
   * Export renders every frame in a loop with no repaint, so a frame that fell
   * back to the solid colour is baked into the file. Preview does not need
   * this, because it redraws.
   *
   * This resolves whether or not the decode worked — a broken background must
   * not take down the editor. Callers that render once should ask
   * `backgroundImageFailed` afterwards.
   */
  async preloadBackgroundImage(url: string): Promise<void> {
    await this.backgroundTextures.preload(this.gl, url);
  }

  /** Whether a preloaded background image could not be decoded. */
  backgroundImageFailed(url: string): boolean {
    return this.backgroundTextures.failedToLoad(url);
  }

  /** Read the drawn frame back as tightly packed RGBA, top row first. */
  readPixels(out: Size): Uint8Array {
    const gl = this.gl;
    const buf = new Uint8Array(out.w * out.h * 4);
    gl.readPixels(0, 0, out.w, out.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    // WebGL origin is bottom-left; rawvideo expects top-left.
    const rowBytes = out.w * 4;
    const flipped = new Uint8Array(buf.length);
    for (let y = 0; y < out.h; y++) {
      const from = (out.h - 1 - y) * rowBytes;
      flipped.set(buf.subarray(from, from + rowBytes), y * rowBytes);
    }

    return flipped;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.bg.program);
    gl.deleteProgram(this.shadow.program);
    gl.deleteProgram(this.screen.program);
    gl.deleteProgram(this.cursorProgram.program);
    gl.deleteProgram(this.rippleProgram.program);
    this.cursorTextures.dispose(gl);
    this.backgroundTextures.dispose(gl);
  }
}
