import type { BlurStrength } from "../project/types";

/**
 * Number of control points in a mesh gradient.
 *
 * The fragment shader declares uniform arrays of exactly this size and loops
 * over them with a constant bound, so the loop stays branch-free. Changing it
 * means changing both this constant and the shader; backgrounds.test.ts asserts
 * every preset agrees with it, because a mismatch throws nothing — the extra
 * points are silently ignored, or the loop reads uninitialised uniforms.
 */
export const MESH_POINTS = 4;

/**
 * A mesh gradient as coloured control points blended by inverse-distance
 * weighting.
 *
 * Generated rather than shipped as bitmaps, per spec §5, for three reasons: a
 * shipped image carries a licence that travels with anything redistributed;
 * generated gradients stay sharp at any export resolution including 4K, where a
 * 1080p bitmap would not; and the installer stays small.
 */
export type GradientPreset = {
  name: string;
  label: string;
  points: Array<{ x: number; y: number; color: string }>;
  /** Higher concentrates each colour nearer its own point. Must exceed 0. */
  falloff: number;
};

/**
 * Six, not twelve — ship curated, not exhaustive.
 *
 * All dark, on the assumption that a screen recording sits on a dark ground and
 * the frame should be the brightest thing in the composition. A light preset is
 * a reasonable future addition; it is a taste call, not a technical one.
 */
export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  {
    name: "aurora",
    label: "aurora",
    points: [
      { x: 0.1, y: 0.15, color: "#1e3a5f" },
      { x: 0.85, y: 0.1, color: "#2d1b4e" },
      { x: 0.2, y: 0.9, color: "#0f2027" },
      { x: 0.9, y: 0.8, color: "#1a4d5c" },
    ],
    falloff: 2.2,
  },
  {
    name: "ember",
    label: "ember",
    points: [
      { x: 0.15, y: 0.2, color: "#3d1a1a" },
      { x: 0.9, y: 0.15, color: "#5c2415" },
      { x: 0.1, y: 0.85, color: "#1a0f0f" },
      { x: 0.8, y: 0.9, color: "#7a3520" },
    ],
    falloff: 2.0,
  },
  {
    name: "slate",
    label: "slate",
    points: [
      { x: 0.2, y: 0.1, color: "#242830" },
      { x: 0.85, y: 0.2, color: "#1a1d24" },
      { x: 0.15, y: 0.9, color: "#12141a" },
      { x: 0.9, y: 0.85, color: "#2a2f38" },
    ],
    falloff: 1.6,
  },
  {
    name: "moss",
    label: "moss",
    points: [
      { x: 0.12, y: 0.18, color: "#1a2e1f" },
      { x: 0.88, y: 0.12, color: "#25402c" },
      { x: 0.18, y: 0.88, color: "#0f1a12" },
      { x: 0.85, y: 0.82, color: "#2f4a35" },
    ],
    falloff: 2.1,
  },
  {
    name: "dusk",
    label: "dusk",
    points: [
      { x: 0.1, y: 0.12, color: "#2b2140" },
      { x: 0.9, y: 0.18, color: "#40304f" },
      { x: 0.2, y: 0.88, color: "#161222" },
      { x: 0.88, y: 0.9, color: "#4a3358" },
    ],
    falloff: 2.3,
  },
  {
    name: "ink",
    label: "ink",
    points: [
      { x: 0.25, y: 0.2, color: "#0d0e11" },
      { x: 0.8, y: 0.25, color: "#15171c" },
      { x: 0.2, y: 0.8, color: "#08090b" },
      { x: 0.85, y: 0.78, color: "#101216" },
    ],
    falloff: 1.4,
  },
];

/**
 * Resolve a preset by name, never throwing.
 *
 * A project.json can name a preset a later build removed, and normalizeProject
 * deliberately preserves unknown preset strings rather than clobbering them, so
 * this is the layer that has to cope.
 */
export function gradientPreset(name: string): GradientPreset {
  return GRADIENT_PRESETS.find((p) => p.name === name) ?? (GRADIENT_PRESETS[0] as GradientPreset);
}

/**
 * Blur radius in output pixels, quoted at 1080p.
 *
 * The renderer scales this by output height, so the blur keeps the same
 * apparent size at 4K export as in a 1080p preview — the same reasoning that
 * keeps the cursor a constant apparent size.
 */
export const BLUR_RADIUS_PX: Record<BlurStrength, number> = {
  none: 0,
  moderate: 16,
  strong: 40,
};
