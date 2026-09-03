import type { StyleConfig } from "../../shared/project/types";
import type { ZoomState } from "../../shared/zoom/interpolate";
import type { Size } from "../../shared/zoom/types";
import { screenQuad } from "./layout";
import { BG_FRAG, QUAD_VERT, SCREEN_FRAG, SHADOW_FRAG } from "./shaders";

export type FrameState = {
  screen: TexImageSource;
  webcam?: TexImageSource;
  zoom: ZoomState;
  style: StyleConfig;
  outputSize: Size;
  sourceSize: Size;
};

type Program = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

const MAX_SHARPEN = 0.6;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

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

    this.bg = link(gl, BG_FRAG, ["u_from", "u_to", "u_angle"]);
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
      "u_radiusPx",
      "u_sharpen",
      "u_texel",
    ]);

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

    this.drawBackground(style);

    const quad = screenQuad(src, out, style.paddingFactor, state.zoom);

    this.drawShadow(quad, out, style);
    this.drawScreen(quad, out, src, style, state.screen);

    gl.bindVertexArray(null);
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

  private drawBackground(style: StyleConfig): void {
    const gl = this.gl;
    gl.useProgram(this.bg.program);

    const bgStyle = style.background;
    const from =
      bgStyle.kind === "gradient" ? hexToRgb(bgStyle.from) : hexToRgb(bgStyle.color);
    const to =
      bgStyle.kind === "gradient" ? hexToRgb(bgStyle.to) : hexToRgb(bgStyle.color);
    const angle = bgStyle.kind === "gradient" ? (bgStyle.angle * Math.PI) / 180 : 0;

    gl.uniform3f(this.bg.uniforms.u_from ?? null, from[0], from[1], from[2]);
    gl.uniform3f(this.bg.uniforms.u_to ?? null, to[0], to[1], to[2]);
    gl.uniform1f(this.bg.uniforms.u_angle ?? null, angle);
    gl.uniform4f(this.bg.uniforms.u_rect ?? null, 0, 0, 1, 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawShadow(
    quad: { x: number; y: number; w: number; h: number },
    out: Size,
    style: StyleConfig,
  ): void {
    const gl = this.gl;
    const { blurPx, opacity, offsetYPx } = style.shadow;
    if (opacity <= 0) return;

    const pad = blurPx * 2;
    const spanW = quad.w + pad * 2;
    const spanH = quad.h + pad * 2;

    gl.useProgram(this.shadow.program);
    gl.uniform2f(this.shadow.uniforms.u_spanPx ?? null, spanW, spanH);
    gl.uniform2f(this.shadow.uniforms.u_halfPx ?? null, quad.w / 2, quad.h / 2);
    gl.uniform1f(this.shadow.uniforms.u_radiusPx ?? null, style.cornerRadiusPx);
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
    out: Size,
    src: Size,
    style: StyleConfig,
    source: TexImageSource,
  ): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // Sharpen only where we are actually upscaling past 1:1
    const sampleScale = quad.w / src.w;
    const sharpen = sampleScale > 1 ? Math.min(MAX_SHARPEN, sampleScale - 1) : 0;

    gl.useProgram(this.screen.program);
    gl.uniform1i(this.screen.uniforms.u_tex ?? null, 0);
    gl.uniform2f(this.screen.uniforms.u_quadPx ?? null, quad.w, quad.h);
    gl.uniform1f(this.screen.uniforms.u_radiusPx ?? null, style.cornerRadiusPx);
    gl.uniform1f(this.screen.uniforms.u_sharpen ?? null, sharpen);
    gl.uniform2f(this.screen.uniforms.u_texel ?? null, 1 / src.w, 1 / src.h);

    this.setRect(this.screen, quad.x, quad.y, quad.w, quad.h, out);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
  }
}
