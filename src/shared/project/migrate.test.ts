import { describe, expect, it } from "vitest";
import { defaultProject } from "./defaults";
import { normalizeProject } from "./migrate";

/** A project.json as any build before the cursor pipeline would have written it. */
const PRE_CURSOR = {
  version: 1,
  bundleId: "2026-09-04T09-45-53",
  cuts: [{ startMs: 100, endMs: 600 }],
  zoom: {
    config: { minHoldMs: 1500, transitionMs: 600 },
    keyframes: [{ tMs: 0, scale: 1, cx: 0.5, cy: 0.5 }],
  },
  style: {
    paddingFactor: 0.85,
    cornerRadiusPx: 12,
    shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
    background: { kind: "gradient", from: "#1b1d23", to: "#0d0e11", angle: 135 },
    // no cursor: this is the field the cursor pipeline added
  },
  webcam: { visible: true, shape: "circle", sizePct: 18, position: "bottom-right", marginPx: 32 },
  audio: { micGainDb: 0, systemGainDb: -6, syncNudgeMs: 0 },
  output: { width: 1920, height: 1080, fps: 60, bitrateMbps: 12 },
};

describe("normalizeProject", () => {
  it("fills in a cursor style that predates the cursor pipeline", () => {
    // Without this the editor throws on style.cursor.smoothing and the take
    // renders nothing at all.
    const p = normalizeProject(PRE_CURSOR, "b");
    expect(p.style.cursor).toEqual(defaultProject("b").style.cursor);
  });

  it("preserves everything the old file did carry", () => {
    const p = normalizeProject(PRE_CURSOR, "b");
    expect(p.cuts).toEqual([{ startMs: 100, endMs: 600 }]);
    expect(p.zoom.keyframes).toHaveLength(1);
    expect(p.style.shadow.blurPx).toBe(48);
    expect(p.style.background).toEqual(PRE_CURSOR.style.background);
    expect(p.audio.systemGainDb).toBe(-6);
    expect(p.output.bitrateMbps).toBe(12);
  });

  it("merges a partial zoom config over the defaults rather than replacing it", () => {
    // An old file carrying only some knobs must not lose the rest.
    const p = normalizeProject(PRE_CURSOR, "b");
    expect(p.zoom.config.minHoldMs).toBe(1500);
    expect(p.zoom.config.clusterRadiusPx).toBe(
      defaultProject("b").zoom.config.clusterRadiusPx,
    );
  });

  it("is a no-op on an already-current project", () => {
    const current = defaultProject("b");
    expect(normalizeProject(current, "b")).toEqual(current);
  });

  it("falls back to defaults for a missing, empty or corrupt file", () => {
    expect(normalizeProject(null, "b")).toEqual(defaultProject("b"));
    expect(normalizeProject(undefined, "b")).toEqual(defaultProject("b"));
    expect(normalizeProject("nonsense", "b")).toEqual(defaultProject("b"));
    expect(normalizeProject([], "b")).toEqual(defaultProject("b"));
    expect(normalizeProject({}, "b")).toEqual(defaultProject("b"));
  });

  it("survives a style that is the wrong type entirely", () => {
    const p = normalizeProject({ style: "nonsense", output: 42 }, "b");
    expect(p.style.paddingFactor).toBe(0.85);
    expect(p.output.width).toBe(1920);
  });

  it("rejects a NaN or non-numeric field rather than propagating it", () => {
    // A NaN reaching the planner or the renderer produces a blank frame with
    // no error, which is far harder to diagnose than a reset value.
    const p = normalizeProject(
      { style: { paddingFactor: "0.9", cursor: { sizePct: Number.NaN } } },
      "b",
    );
    expect(p.style.paddingFactor).toBe(0.85);
    expect(p.style.cursor.sizePct).toBe(100);
  });

  it("drops a background whose kind is not a known arm", () => {
    // Partially merging across union arms would yield a shape matching neither.
    const p = normalizeProject({ style: { background: { kind: "mesh", preset: "x" } } }, "b");
    expect(p.style.background).toEqual(defaultProject("b").style.background);
  });

  it("keeps the caller's bundleId when the file disagrees", () => {
    // The directory a bundle loaded from is the truth; a copied project
    // directory would otherwise keep a stale id.
    expect(normalizeProject({ ...PRE_CURSOR, bundleId: "stale" }, "real").bundleId).toBe("real");
  });
});
