import { describe, expect, it } from "vitest";
import { defaultProject } from "../project/defaults";
import { BLUR_RADIUS_PX, GRADIENT_PRESETS, MESH_POINTS, gradientPreset } from "./backgrounds";

describe("GRADIENT_PRESETS", () => {
  it("ships a curated set, not an exhaustive one", () => {
    // Spec §5 chose generation over twelve shipped bitmaps; the point was a
    // tight launch set, not a full catalogue.
    expect(GRADIENT_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(GRADIENT_PRESETS.length).toBeLessThanOrEqual(8);
  });

  it("has unique names", () => {
    const names = GRADIENT_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every preset exactly MESH_POINTS control points", () => {
    // The shader declares a fixed-size array and loops over it. If these ever
    // disagree the extra points are silently ignored, or the loop reads
    // uninitialised uniforms — neither of which throws.
    for (const p of GRADIENT_PRESETS) {
      expect(p.points, p.name).toHaveLength(MESH_POINTS);
    }
  });

  it("keeps control points inside the frame", () => {
    for (const p of GRADIENT_PRESETS) {
      for (const pt of p.points) {
        expect(pt.x, p.name).toBeGreaterThanOrEqual(0);
        expect(pt.x, p.name).toBeLessThanOrEqual(1);
        expect(pt.y, p.name).toBeGreaterThanOrEqual(0);
        expect(pt.y, p.name).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives every control point a parseable six-digit hex colour", () => {
    // hexToRgb in Renderer accepts 3- or 6-digit; pinning 6 keeps the table
    // uniform and makes a truncated paste obvious.
    for (const p of GRADIENT_PRESETS) {
      for (const pt of p.points) expect(pt.color, `${p.name}: ${pt.color}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("keeps falloff positive, so the shader never divides by zero", () => {
    for (const p of GRADIENT_PRESETS) expect(p.falloff, p.name).toBeGreaterThan(0);
  });

  it("spreads control points apart, so a preset is a gradient and not a flat fill", () => {
    // Four points at the same spot average to one colour everywhere.
    for (const p of GRADIENT_PRESETS) {
      const xs = p.points.map((pt) => pt.x);
      const ys = p.points.map((pt) => pt.y);
      const spread = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
      expect(spread, p.name).toBeGreaterThan(0.5);
    }
  });

  it("contains the preset defaultProject names, so the default is renderable", () => {
    const name = defaultProject("b").style.background.preset;
    expect(GRADIENT_PRESETS.some((p) => p.name === name)).toBe(true);
  });
});

describe("gradientPreset", () => {
  it("resolves a known name", () => {
    expect(gradientPreset("aurora").name).toBe("aurora");
  });

  it("falls back rather than throwing on an unknown name", () => {
    // A project.json can name a preset a later build removed, and
    // normalizeProject deliberately preserves unknown preset strings.
    expect(gradientPreset("no-such-preset")).toBe(GRADIENT_PRESETS[0]);
    expect(gradientPreset("")).toBe(GRADIENT_PRESETS[0]);
  });
});

describe("BLUR_RADIUS_PX", () => {
  it("is zero at none and strictly increasing", () => {
    expect(BLUR_RADIUS_PX.none).toBe(0);
    expect(BLUR_RADIUS_PX.moderate).toBeGreaterThan(BLUR_RADIUS_PX.none);
    expect(BLUR_RADIUS_PX.strong).toBeGreaterThan(BLUR_RADIUS_PX.moderate);
  });
});
