import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { toImpulses } from "./impulses";

const cfg = DEFAULT_ZOOM_CONFIG;

describe("toImpulses", () => {
  it("emits a full-weight impulse for a click", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "down", x: 10, y: 20, b: 1 }];
    expect(toImpulses(ev, cfg)).toEqual([{ t: 100, x: 10, y: 20, w: 1, srcIndex: 0 }]);
  });

  it("emits nothing for movement alone", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "move", x: 10, y: 20 }];
    expect(toImpulses(ev, cfg)).toEqual([]);
  });

  it("anchors typing on a recent click", () => {
    const ev: TelemetryEvent[] = [
      { t: 100, k: "down", x: 500, y: 400, b: 1 },
      { t: 200, k: "move", x: 900, y: 900 },
      { t: 1000, k: "key", d: "down", c: "KeyA" },
    ];
    expect(toImpulses(ev, cfg)[1]).toEqual({
      t: 1000,
      x: 500,
      y: 400,
      w: 0.4,
      srcIndex: 2,
    });
  });

  it("falls back to cursor position when the click is stale", () => {
    const ev: TelemetryEvent[] = [
      { t: 0, k: "down", x: 500, y: 400, b: 1 },
      { t: 100, k: "move", x: 900, y: 900 },
      { t: 9000, k: "key", d: "down", c: "KeyA" },
    ];
    expect(toImpulses(ev, cfg)[1]).toEqual({
      t: 9000,
      x: 900,
      y: 900,
      w: 0.4,
      srcIndex: 2,
    });
  });

  it("ignores key-up and typing with no prior position", () => {
    const ev: TelemetryEvent[] = [
      { t: 100, k: "key", d: "down", c: "KeyA" },
      { t: 200, k: "key", d: "up", c: "KeyA" },
    ];
    expect(toImpulses(ev, cfg)).toEqual([]);
  });

  it("emits a light impulse for scrolling", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "wheel", x: 10, y: 20, dy: -120 }];
    expect(toImpulses(ev, cfg)[0]?.w).toBe(0.3);
  });
});
