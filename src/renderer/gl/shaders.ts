/**
 * All geometry is a unit quad. `u_rect` places it in output space using a
 * top-left origin (x, y, w, h all normalised 0..1), and the vertex shader
 * flips Y into clip space. Textures are uploaded WITHOUT UNPACK_FLIP_Y_WEBGL,
 * which already places the image's top row at t=0, so v_uv.y = 0 is the top of
 * the image. Enabling the unpack flip as well flips twice.
 */
export const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform vec4 u_rect;
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

export const BG_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3  u_from;
uniform vec3  u_to;
uniform float u_angle;
out vec4 frag;
void main() {
  vec2 dir = vec2(cos(u_angle), sin(u_angle));
  float t = clamp(dot(v_uv - 0.5, dir) + 0.5, 0.0, 1.0);
  frag = vec4(mix(u_from, u_to, t), 1.0);
}`;

const SD_ROUND_RECT = `
float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - (halfSize - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}`;

/**
 * A soft-edged rounded rect standing in for a blurred shadow. A real gaussian
 * would be a multi-pass job for a difference nobody would notice at this size.
 */
export const SHADOW_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2  u_spanPx;
uniform vec2  u_halfPx;
uniform float u_radiusPx;
uniform float u_blurPx;
uniform float u_opacity;
out vec4 frag;
${SD_ROUND_RECT}
void main() {
  vec2 p = (v_uv - 0.5) * u_spanPx;
  float d = sdRoundRect(p, u_halfPx, u_radiusPx);
  float a = u_opacity * (1.0 - smoothstep(-u_blurPx, u_blurPx, d));
  frag = vec4(0.0, 0.0, 0.0, a);
}`;

export const SCREEN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2  u_quadPx;
uniform float u_radiusPx;
uniform float u_sharpen;
uniform vec2  u_texel;
out vec4 frag;
${SD_ROUND_RECT}
void main() {
  vec3 c = texture(u_tex, v_uv).rgb;

  if (u_sharpen > 0.0) {
    vec3 blur = texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb
              + texture(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb;
    c = clamp(c + u_sharpen * (c - blur * 0.25), 0.0, 1.0);
  }

  vec2 p = (v_uv - 0.5) * u_quadPx;
  float d = sdRoundRect(p, u_quadPx * 0.5, u_radiusPx);
  frag = vec4(c, 1.0 - smoothstep(-1.0, 1.0, d));
}`;
