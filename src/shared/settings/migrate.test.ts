import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { normalizeSettings } from "./migrate";

describe("normalizeSettings", () => {
  it("defaults captureFps to 60", () => {
    expect(defaultSettings().captureFps).toBe(60);
  });

  it("returns defaults for anything that is not an object", () => {
    for (const raw of [null, undefined, 3, "x", []]) {
      expect(normalizeSettings(raw)).toEqual(defaultSettings());
    }
  });

  it("keeps a valid stored value", () => {
    expect(normalizeSettings({ captureFps: 30 }).captureFps).toBe(30);
  });

  /**
   * A rate outside the offered set is replaced, not clamped to the nearest
   * choice. A hand-edited 144 would otherwise ask gdigrab for a rate it cannot
   * serve and silently produce a worse recording than either choice.
   */
  it("replaces an unoffered rate with the default", () => {
    for (const bad of [0, -1, 24, 144, Number.NaN, "60", null]) {
      expect(normalizeSettings({ captureFps: bad }).captureFps).toBe(60);
    }
  });

  it("ignores unknown keys rather than carrying them", () => {
    expect(normalizeSettings({ captureFps: 30, somethingOld: true })).toEqual({
      captureFps: 30,
    });
  });
});
