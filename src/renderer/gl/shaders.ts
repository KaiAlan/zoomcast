import { MESH_POINTS } from "../../shared/style/backgrounds";

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

/**
 * Background: mesh gradient, solid colour, or an image.
 *
 * The mesh is inverse-distance weighting over MESH_POINTS coloured control
 * points — cheap, unconditionally smooth, and free of the banding a two-stop
 * linear gradient shows across a dark palette. u_mode picks the branch; the
 * loop bound is a compile-time constant so the program stays branch-free
 * inside it.
 *
 * Distances are measured in square space via u_aspect. Without that a preset
 * smears horizontally on 16:9 and vertically on 9:16, so the same preset would
 * look like two different gradients once aspect ratio became selectable.
 *
 * The blur samples the mesh at a 3x3 kernel rather than running a second pass
 * over a framebuffer. At this kernel size evaluating the mesh nine times is
 * cheaper than the round trip, because each evaluation is a handful of
 * reciprocals rather than a texture fetch. The image branch does pay for taps,
 * which is why its kernel is the same nine and not more.
 */
export const BG_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform int   u_mode;        // 0 = mesh, 1 = solid, 2 = image
uniform vec3  u_color;
uniform vec2  u_points[${MESH_POINTS}];
uniform vec3  u_colors[${MESH_POINTS}];
uniform float u_falloff;
uniform float u_aspect;      // output w/h, so distance is measured square
uniform float u_blurPx;
uniform vec2  u_texelPx;     // 1/outputW, 1/outputH
uniform sampler2D u_image;
uniform vec2  u_imageScale;  // cover-fit scale, applied about the centre
out vec4 frag;

vec3 mesh(vec2 uv) {
  vec2 p = vec2(uv.x * u_aspect, uv.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${MESH_POINTS}; i++) {
    vec2 d = p - vec2(u_points[i].x * u_aspect, u_points[i].y);
    // The epsilon keeps the weight finite exactly at a control point, where
    // the distance is zero and the reciprocal would otherwise be infinite.
    float w = 1.0 / (dot(d, d) * u_falloff + 0.0005);
    acc += u_colors[i] * w;
    wsum += w;
  }

  return acc / wsum;
}

vec3 image(vec2 uv) {
  // Cover fit: scale about the centre so the short edge fills and the long
  // edge is cropped, never letterboxed.
  vec2 c = (uv - 0.5) * u_imageScale + 0.5;
  return texture(u_image, c).rgb;
}

vec3 sample_bg(vec2 uv) {
  if (u_mode == 1) return u_color;
  if (u_mode == 2) return image(uv);
  return mesh(uv);
}

void main() {
  if (u_blurPx <= 0.0) {
    frag = vec4(sample_bg(v_uv), 1.0);
    return;
  }

  vec2 step = u_texelPx * u_blurPx;
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += sample_bg(v_uv + vec2(float(x), float(y)) * step);
    }
  }
  frag = vec4(sum / 9.0, 1.0);
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

export const CURSOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_shadow;

void main() {
  vec4 c = texture(u_tex, v_uv);

  if (u_shadow > 0.5) {
    // Offset alpha tap, so the cursor reads against light backgrounds too.
    float s = texture(u_tex, v_uv - vec2(0.02, 0.02)).a * 0.35;
    // Source-over, not mix(): mix gives output alpha s(1-c.a) + c.a*c.a, which
    // squashes the glyph's antialiased boundary (0.5 becomes 0.425 at s=0.35)
    // and renders every edge thinner and more transparent than intended.
    float a = c.a + s * (1.0 - c.a);
    outColor = vec4(c.rgb * c.a / max(a, 1e-4), a);
  } else {
    outColor = c;
  }
}
`;

export const RIPPLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_progress;

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float d = length(p);

  // A ring that expands and fades: radius tracks progress, alpha falls away.
  float ring = smoothstep(0.06, 0.0, abs(d - u_progress));
  float fade = 1.0 - u_progress;

  outColor = vec4(1.0, 1.0, 1.0, ring * fade * 0.5);
}
`;
