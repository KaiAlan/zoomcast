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
    expect(p.style.frame.shadow.blurPx).toBe(48);
    // from/to/angle are gone with the union; kind survives the rename.
    expect(p.style.background.kind).toBe("gradient");
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

  it("resets an unknown background kind but keeps the other kinds' settings", () => {
    // Background stopped being a union in phase B precisely so that toggling
    // kind does not discard the settings of the kinds you are not on. So only
    // the bad field resets. An unrecognised preset NAME is left alone on
    // purpose: gradientPreset() resolves unknown names to a default at render
    // time, so keeping it costs nothing and survives a downgrade.
    const p = normalizeProject(
      { style: { background: { kind: "hologram", preset: "x", color: "#abcdef" } } },
      "b",
    );
    expect(p.style.background.kind).toBe(defaultProject("b").style.background.kind);
    expect(p.style.background.preset).toBe("x");
    expect(p.style.background.color).toBe("#abcdef");
  });

  it("moves the loose frame fields under style.frame", () => {
    // Phase B grouped cornerRadiusPx and shadow so a preset can set them
    // together. PRE_CURSOR carries them at the old top level.
    const p = normalizeProject(PRE_CURSOR, "b");
    expect(p.style.frame.cornerRadiusPx).toBe(12);
    expect(p.style.frame.shadow).toEqual({ blurPx: 48, opacity: 0.35, offsetYPx: 16 });
    expect(p.style.frame.preset).toBe("default");
  });

  it("prefers the new frame location over the legacy one when both exist", () => {
    const p = normalizeProject(
      {
        style: {
          cornerRadiusPx: 12,
          shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
          frame: { cornerRadiusPx: 40, shadow: { blurPx: 4, opacity: 0.1, offsetYPx: 2 } },
        },
      },
      "b",
    );
    expect(p.style.frame.cornerRadiusPx).toBe(40);
    expect(p.style.frame.shadow.blurPx).toBe(4);
  });

  it("renames the old solid background kind and keeps its colour", () => {
    const p = normalizeProject({ style: { background: { kind: "solid", color: "#123456" } } }, "b");
    expect(p.style.background.kind).toBe("color");
    expect(p.style.background.color).toBe("#123456");
  });

  it("falls back to the default preset for an old two-stop gradient", () => {
    // from/to/angle have no faithful mesh equivalent, so the colours are lost
    // on purpose rather than approximated into something that is neither.
    const p = normalizeProject(
      { style: { background: { kind: "gradient", from: "#1b1d23", to: "#0d0e11", angle: 135 } } },
      "b",
    );
    expect(p.style.background.kind).toBe("gradient");
    expect(p.style.background.preset).toBe(defaultProject("b").style.background.preset);
  });

  it("never invents a blur an old project did not ask for", () => {
    expect(normalizeProject(PRE_CURSOR, "b").style.background.blur).toBe("none");
    expect(normalizeProject({ style: { background: { blur: "wat" } } }, "b").style.background.blur)
      .toBe("none");
  });

  it("defaults output.aspect to native, so existing exports are unchanged", () => {
    const p = normalizeProject(PRE_CURSOR, "b");
    expect(p.output.aspect).toBe("native");
    expect(p.output.width).toBe(1920);
    expect(p.output.height).toBe(1080);
  });

  it("rejects an unknown enum value rather than passing it to the renderer", () => {
    const p = normalizeProject(
      {
        style: { frame: { preset: "fancy" }, background: { kind: "hologram" } },
        output: { aspect: "21:9" },
      },
      "b",
    );
    expect(p.style.frame.preset).toBe("default");
    expect(p.style.background.kind).toBe("gradient");
    expect(p.output.aspect).toBe("native");
  });

  it("keeps a null imageFile null rather than coercing it to a string", () => {
    expect(normalizeProject({ style: { background: { imageFile: 42 } } }, "b")
      .style.background.imageFile).toBeNull();
    expect(normalizeProject({ style: { background: { imageFile: "bg-1.png" } } }, "b")
      .style.background.imageFile).toBe("bg-1.png");
  });

  it("keeps the caller's bundleId when the file disagrees", () => {
    // The directory a bundle loaded from is the truth; a copied project
    // directory would otherwise keep a stale id.
    expect(normalizeProject({ ...PRE_CURSOR, bundleId: "stale" }, "real").bundleId).toBe("real");
  });
});
