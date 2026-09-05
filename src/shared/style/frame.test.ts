import { describe, expect, it } from "vitest";
import type { FrameStyle } from "../project/types";
import { FRAME_PRESETS, resolveFrame } from "./frame";

const base: FrameStyle = {
  preset: "default",
  cornerRadiusPx: 12,
  shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
  border: { visible: false, widthPx: 1, color: "#ffffff22" },
};

describe("FRAME_PRESETS", () => {
  it("makes hidden actually hidden: no radius, no shadow, no border", () => {
    const hidden = FRAME_PRESETS.hidden;
    expect(hidden.cornerRadiusPx).toBe(0);
    expect(hidden.shadow.opacity).toBe(0);
    expect(hidden.border.visible).toBe(false);
  });

  it("makes minimal lighter than default, not absent", () => {
    // "minimal" that renders identically to "hidden" would make one of the
    // three presets pointless.
    expect(FRAME_PRESETS.minimal.shadow.opacity).toBeGreaterThan(0);
    expect(FRAME_PRESETS.minimal.shadow.opacity).toBeLessThan(
      FRAME_PRESETS.default.shadow.opacity,
    );
    expect(FRAME_PRESETS.minimal.cornerRadiusPx).toBeLessThan(
      FRAME_PRESETS.default.cornerRadiusPx,
    );
  });
});

describe("resolveFrame", () => {
  it("returns the preset's own values for minimal and hidden", () => {
    expect(resolveFrame({ ...base, preset: "hidden" }).cornerRadiusPx).toBe(0);
    expect(resolveFrame({ ...base, preset: "minimal" })).toEqual(FRAME_PRESETS.minimal);
  });

  it("returns the user's own values under the default preset", () => {
    // "default" is the EDITABLE preset: picking it hands control back to the
    // individual fields rather than overwriting them, so a user who tunes a
    // radius and then tours the presets gets their radius back.
    expect(resolveFrame({ ...base, cornerRadiusPx: 40 }).cornerRadiusPx).toBe(40);
  });

  it("ignores the individual fields under a non-default preset", () => {
    // Otherwise the UI would show controls that silently do nothing.
    const edited = { ...base, preset: "minimal" as const, cornerRadiusPx: 40 };
    expect(resolveFrame(edited).cornerRadiusPx).toBe(FRAME_PRESETS.minimal.cornerRadiusPx);
  });

  it("never returns a negative radius, width, or blur", () => {
    const wild: FrameStyle = {
      ...base,
      cornerRadiusPx: -5,
      shadow: { blurPx: -10, opacity: 0.3, offsetYPx: -4 },
      border: { visible: true, widthPx: -2, color: "#fff" },
    };
    const r = resolveFrame(wild);
    expect(r.cornerRadiusPx).toBe(0);
    expect(r.shadow.blurPx).toBe(0);
    expect(r.border.widthPx).toBe(0);
    // offsetY is a signed offset: a negative one lifts the shadow, which is legal.
    expect(r.shadow.offsetYPx).toBe(-4);
  });

  it("clamps opacity into 0..1", () => {
    expect(resolveFrame({ ...base, shadow: { ...base.shadow, opacity: 3 } }).shadow.opacity).toBe(1);
    expect(resolveFrame({ ...base, shadow: { ...base.shadow, opacity: -1 } }).shadow.opacity).toBe(0);
  });
});
