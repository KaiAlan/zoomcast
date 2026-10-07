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

/** Curated bright, pastel and dark meshes. Existing preset names remain stable. */
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
  { name: "solar", label: "Solar", points: [{ x: 0.08, y: 0.12, color: "#ffcc85" }, { x: 0.9, y: 0.15, color: "#ff6b64" }, { x: 0.12, y: 0.9, color: "#ffdba6" }, { x: 0.92, y: 0.85, color: "#f33b92" }], falloff: 1.8 },
  { name: "lagoon", label: "Lagoon", points: [{ x: 0.08, y: 0.12, color: "#00d6d1" }, { x: 0.9, y: 0.15, color: "#62e2fc" }, { x: 0.12, y: 0.9, color: "#086eda" }, { x: 0.92, y: 0.85, color: "#1530a3" }], falloff: 1.8 },
  { name: "citrus", label: "Citrus", points: [{ x: 0.08, y: 0.12, color: "#d9fa82" }, { x: 0.9, y: 0.15, color: "#fff4a1" }, { x: 0.12, y: 0.9, color: "#7ddb97" }, { x: 0.92, y: 0.85, color: "#a9edcd" }], falloff: 1.8 },
  { name: "orchid", label: "Orchid", points: [{ x: 0.08, y: 0.12, color: "#ec9df5" }, { x: 0.9, y: 0.15, color: "#db62cd" }, { x: 0.12, y: 0.9, color: "#ae5ce8" }, { x: 0.92, y: 0.85, color: "#f6b4e4" }], falloff: 1.8 },
  { name: "coral", label: "Coral", points: [{ x: 0.08, y: 0.12, color: "#ff9a9e" }, { x: 0.9, y: 0.15, color: "#fecfbb" }, { x: 0.12, y: 0.9, color: "#fd6c8a" }, { x: 0.92, y: 0.85, color: "#ffb58b" }], falloff: 1.8 },
  { name: "sky", label: "Sky", points: [{ x: 0.08, y: 0.12, color: "#88d6ff" }, { x: 0.9, y: 0.15, color: "#c9f0ff" }, { x: 0.12, y: 0.9, color: "#4d8fe8" }, { x: 0.92, y: 0.85, color: "#a8bcff" }], falloff: 1.8 },
  { name: "violet", label: "Violet", points: [{ x: 0.08, y: 0.12, color: "#bd98ff" }, { x: 0.9, y: 0.15, color: "#7853f5" }, { x: 0.12, y: 0.9, color: "#e0b7ff" }, { x: 0.92, y: 0.85, color: "#4736c5" }], falloff: 1.8 },
  { name: "peach", label: "Peach", points: [{ x: 0.08, y: 0.12, color: "#fff0da" }, { x: 0.9, y: 0.15, color: "#ffb99d" }, { x: 0.12, y: 0.9, color: "#f4cbdc" }, { x: 0.92, y: 0.85, color: "#ffe2bc" }], falloff: 1.8 },
  { name: "mint", label: "Mint", points: [{ x: 0.08, y: 0.12, color: "#d1f7dd" }, { x: 0.9, y: 0.15, color: "#8be8dc" }, { x: 0.12, y: 0.9, color: "#89d3bd" }, { x: 0.92, y: 0.85, color: "#c5f1eb" }], falloff: 1.8 },
  { name: "sapphire", label: "Sapphire", points: [{ x: 0.08, y: 0.12, color: "#4db5ff" }, { x: 0.9, y: 0.15, color: "#2353c9" }, { x: 0.12, y: 0.9, color: "#1d3589" }, { x: 0.92, y: 0.85, color: "#6b91ff" }], falloff: 1.8 },
  { name: "rose", label: "Rose", points: [{ x: 0.08, y: 0.12, color: "#ffe1e9" }, { x: 0.9, y: 0.15, color: "#f7a8c2" }, { x: 0.12, y: 0.9, color: "#f18eb0" }, { x: 0.92, y: 0.85, color: "#eac5ed" }], falloff: 1.8 },
  { name: "prism", label: "Prism", points: [{ x: 0.08, y: 0.12, color: "#50d4f8" }, { x: 0.9, y: 0.15, color: "#d784f5" }, { x: 0.12, y: 0.9, color: "#fb81b5" }, { x: 0.92, y: 0.85, color: "#ffbd75" }], falloff: 1.8 },
  { name: "sunset", label: "Sunset", points: [{ x: 0.08, y: 0.12, color: "#ffbd61" }, { x: 0.9, y: 0.15, color: "#ff7856" }, { x: 0.12, y: 0.9, color: "#c953bb" }, { x: 0.92, y: 0.85, color: "#6142ba" }], falloff: 1.8 },
  { name: "seafoam", label: "Seafoam", points: [{ x: 0.08, y: 0.12, color: "#a0fff1" }, { x: 0.9, y: 0.15, color: "#03b2bc" }, { x: 0.12, y: 0.9, color: "#19798d" }, { x: 0.92, y: 0.85, color: "#83d8c7" }], falloff: 1.8 },
  { name: "lilac", label: "Lilac", points: [{ x: 0.08, y: 0.12, color: "#e9dcff" }, { x: 0.9, y: 0.15, color: "#b4b5ef" }, { x: 0.12, y: 0.9, color: "#f7d7ec" }, { x: 0.92, y: 0.85, color: "#c6a6e6" }], falloff: 1.8 },
  { name: "golden", label: "Golden", points: [{ x: 0.08, y: 0.12, color: "#fff3ad" }, { x: 0.9, y: 0.15, color: "#efb34e" }, { x: 0.12, y: 0.9, color: "#f6db88" }, { x: 0.92, y: 0.85, color: "#ffc57d" }], falloff: 1.8 },
  { name: "midnight", label: "Midnight", points: [{ x: 0.08, y: 0.12, color: "#132147" }, { x: 0.9, y: 0.15, color: "#254780" }, { x: 0.12, y: 0.9, color: "#332951" }, { x: 0.92, y: 0.85, color: "#142d3c" }], falloff: 1.8 },
  { name: "linen", label: "Linen", points: [{ x: 0.08, y: 0.12, color: "#fcf7ec" }, { x: 0.9, y: 0.15, color: "#e9dfd0" }, { x: 0.12, y: 0.9, color: "#f1e9df" }, { x: 0.92, y: 0.85, color: "#e2d6c5" }], falloff: 1.8 },
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
 * Blur as a mipmap level on the background image.
 *
 * Each level is a halving, so 2 samples a quarter-size image and 4 a
 * sixteenth. Expressed as a LOD rather than a pixel radius because LOD is
 * relative to the texture: a 4K export and a 1080p preview then blur the image
 * by the same visual amount with no scaling arithmetic, and the cost is one
 * hardware-filtered fetch at any strength.
 *
 * Applies to image backgrounds only. On a procedural mesh a blur is a measured
 * no-op — RMS 0.1 out of 255 between "none" and "strong" — because the mesh is
 * already smooth by construction, so the control is not offered there.
 */
export const BLUR_LOD: Record<BlurStrength, number> = {
  none: 0,
  moderate: 2.5,
  strong: 4.5,
};
