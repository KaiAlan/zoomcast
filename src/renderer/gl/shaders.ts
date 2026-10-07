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
 * Blur is a mipmap LOD on the image branch, and nothing at all elsewhere.
 *
 * The first attempt was a 3x3 kernel over the sampled background. That is
 * wrong twice over. On a mesh it is a measured no-op — the mesh is already
 * smooth by construction, RMS 0.1/255 between "none" and "strong". On an image
 * it does not blur at all: at "strong" the taps land 27px apart, so a grid
 * renders as three distinct copies rather than a soft one. Nine taps cannot
 * represent a 27px radius; only a wide kernel or a separable two-pass can, and
 * both cost far more than this is worth for a static background.
 *
 * textureLod against a mipmapped texture is a real, hardware-filtered
 * downsample, one instruction, correct at any radius, and resolution
 * independent by construction — LOD is relative to the texture, so a 4K export
 * and a 1080p preview blur the image by the same visual amount without any
 * scaling arithmetic.
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
uniform sampler2D u_image;
uniform vec2  u_imageScale;  // cover-fit scale, applied about the centre
uniform float u_lod;         // mipmap level; 0 is the full-resolution image
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
  return textureLod(u_image, c, u_lod).rgb;
}

void main() {
  if (u_mode == 1) frag = vec4(u_color, 1.0);
  else if (u_mode == 2) frag = vec4(image(v_uv), 1.0);
  else frag = vec4(mesh(v_uv), 1.0);
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
uniform float u_borderPx;
uniform vec4  u_borderColor;
uniform vec2  u_uv0;
uniform vec2  u_uv1;
uniform float u_blurPx;      // directional motion blur, in OUTPUT pixels
uniform vec2  u_blurDir;     // unit vector along the camera velocity
uniform int   u_blurKernel;  // 5, 9 or 11
out vec4 frag;
${SD_ROUND_RECT}
void main() {
  // The camera: sample this region of the recording across the fixed frame.
  // v_uv still drives the rounded-rect SDF below, because that is in quad
  // space and the quad no longer changes.
  vec2 uv = u_uv0 + v_uv * (u_uv1 - u_uv0);

  // Directional motion blur. Taps are spread along the velocity vector so the
  // total smear is u_blurPx OUTPUT pixels: the sampled region (u_uv1 - u_uv0)
  // spans u_quadPx output pixels, which is the conversion. Doing it in output
  // space means the smear does not change with zoom depth for a given camera
  // speed, which is what makes it read as motion rather than as softness.
  vec3 c;
  if (u_blurPx > 0.0) {
    vec2 uvPerOutPx = (u_uv1 - u_uv0) / max(u_quadPx, vec2(1.0));
    vec2 tap = u_blurDir * uvPerOutPx * u_blurPx;
    float halfK = float(u_blurKernel - 1) * 0.5;

    vec3 sum = vec3(0.0);
    // Constant loop bound with an inner break: GLSL ES 3.0 requires the bound
    // to be a constant expression. 11 is the largest kernel step.
    for (int i = 0; i < 11; i++) {
      if (i >= u_blurKernel) break;
      float off = (float(i) - halfK) / max(halfK, 1.0);
      sum += texture(u_tex, uv + tap * off).rgb;
    }
    c = sum / float(u_blurKernel);
  } else {
    c = texture(u_tex, uv).rgb;
  }

  if (u_sharpen > 0.0) {
    vec3 blur = texture(u_tex, uv + vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, uv - vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, uv + vec2(0.0, u_texel.y)).rgb
              + texture(u_tex, uv - vec2(0.0, u_texel.y)).rgb;
    c = clamp(c + u_sharpen * (c - blur * 0.25), 0.0, 1.0);
  }

  vec2 p = (v_uv - 0.5) * u_quadPx;
  float d = sdRoundRect(p, u_quadPx * 0.5, u_radiusPx);
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);

  // The border is a ring just inside the same SDF, not a separate quad. Drawn
  // as its own quad it would square off the corners, because only this shader
  // knows where the rounded edge actually is. d is negative inside, so the
  // ring is the band from -u_borderPx to 0, feathered by the same 1px the
  // corner mask uses so the two edges match.
  if (u_borderPx > 0.0) {
    float inner = smoothstep(-u_borderPx - 1.0, -u_borderPx + 1.0, d);
    float ring = inner * alpha;
    c = mix(c, u_borderColor.rgb, ring * u_borderColor.a);
  }

  frag = vec4(c, alpha);
}`;

export const CURSOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_shadow;
uniform vec2 u_spanPx;
uniform float u_texturePx;
uniform vec2 u_hotPx;
uniform float u_angle;
uniform vec2 u_cursorBlur;

vec4 glyph(vec2 outputPx) {
  float c = cos(u_angle), s = sin(u_angle);
  vec2 local = vec2(c * outputPx.x + s * outputPx.y, -s * outputPx.x + c * outputPx.y);
  vec2 uv = (local + u_hotPx) / u_texturePx;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  vec4 color = texture(u_tex, uv);
  if (u_shadow > 0.5) {
    float shadow = texture(u_tex, uv - vec2(0.02)).a * 0.35;
    float a = color.a + shadow * (1.0 - color.a);
    color = vec4(color.rgb * color.a / max(a, 1e-4), a);
  }
  return color;
}
void main() {
  vec2 p = (v_uv - 0.5) * u_spanPx;
  if (length(u_cursorBlur) < 0.01) { outColor = glyph(p); return; }
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    vec4 tap = glyph(p + u_cursorBlur * (float(i) / 8.0));
    sum += vec4(tap.rgb * tap.a, tap.a);
  }
  sum /= 9.0;
  outColor = vec4(sum.rgb / max(sum.a, 1e-4), sum.a);
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
