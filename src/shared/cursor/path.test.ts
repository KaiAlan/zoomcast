import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { buildCursorPath, cursorAt, smoothingToHalfLife } from "./path";

const opts = { halfLifeMs: smoothingToHalfLife(0.8), sampleHz: 120 };

describe("buildCursorPath", () => {
  it("returns an empty path for no events at all", () => {
    const path = buildCursorPath([], opts);
    expect(path.xs).toHaveLength(0);
    expect(cursorAt(path, 0)).toBeNull();
  });

  it("returns an empty path for a stream with no coordinates", () => {
    // A real case: this machine has a take with 40 key events and no mouse
    // movement. Keystrokes carry no coordinates, so there is nothing to draw.
    const events: TelemetryEvent[] = [
      { t: 0, k: "key", d: "down", c: "65" },
      { t: 100, k: "key", d: "up", c: "65" },
    ];
    const path = buildCursorPath(events, opts);
    expect(path.xs).toHaveLength(0);
    expect(cursorAt(path, 50)).toBeNull();
  });

  it("returns null for a time before any telemetry", () => {
    const path = buildCursorPath([{ t: 1000, k: "move", x: 10, y: 10 }], opts);
    expect(cursorAt(path, 0)).toBeNull();
  });

  it("settles on a stationary target", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 100, y: 100 },
      { t: 2000, k: "move", x: 100, y: 100 },
    ];
    const s = cursorAt(buildCursorPath(events, opts), 2000);
    expect(s?.x).toBeCloseTo(100, 1);
    expect(s?.y).toBeCloseTo(100, 1);
  });

  it("lags a step change rather than jumping to it", () => {
    // Damping is the whole point: at the instant the target moves, the drawn
    // position must still be near where it was.
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 1000, k: "move", x: 500, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    const at = cursorAt(path, 1020);
    expect(at?.x).toBeGreaterThan(0);
    expect(at?.x).toBeLessThan(400);
  });

  it("never overshoots the target", () => {
    // An exponential lag approaches its target and never passes it. That is
    // the reason it was chosen over a spring: a spring can be tuned not to
    // overshoot, but cannot be made structurally incapable of it.
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 200, k: "move", x: 300, y: 0 },
      { t: 3000, k: "move", x: 300, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    for (let t = 0; t <= 3000; t += 10) {
      const s = cursorAt(path, t);
      if (s !== null) expect(s.x).toBeLessThanOrEqual(300.001);
    }
  });

  it("is deterministic for the same input", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 500, k: "move", x: 200, y: 300 },
    ];
    const a = buildCursorPath(events, opts);
    const b = buildCursorPath(events, opts);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
  });

  it("follows the target exactly when smoothing is zero", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 500, k: "move", x: 200, y: 0 },
    ];
    const s = cursorAt(buildCursorPath(events, { halfLifeMs: smoothingToHalfLife(0), sampleHz: 120 }), 500);
    expect(s?.x).toBeCloseTo(200, 0);
  });

  it("carries the shape in force at that time", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 100, k: "cursor", shape: "hand" },
      { t: 500, k: "move", x: 10, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    expect(cursorAt(path, 50)?.shape).toBe("arrow");
    expect(cursorAt(path, 400)?.shape).toBe("hand");
  });

});

describe("halfLifeMs", () => {
  const events: TelemetryEvent[] = [
    { k: "move", t: 0, x: 0, y: 0 },
    { k: "move", t: 500, x: 1000, y: 0 },
  ];

  it("damps more at a longer half-life", () => {
    const quick = buildCursorPath(events, { halfLifeMs: 30, sampleHz: 120 });
    const slow = buildCursorPath(events, { halfLifeMs: 400, sampleHz: 120 });

    const at = (p: ReturnType<typeof buildCursorPath>) => cursorAt(p, 520)?.x ?? 0;
    // Both lag the step; the camera-scale path lags much further behind.
    expect(at(quick)).toBeGreaterThan(at(slow));
  });

  it("maps the 0-1 presentation control onto a cursor-scale half-life", () => {
    expect(smoothingToHalfLife(0)).toBeLessThan(smoothingToHalfLife(1));
    expect(smoothingToHalfLife(1)).toBeLessThanOrEqual(90);
  });

  /**
   * The camera must not become jittery because the user turned the CURSOR's
   * smoothing off. That is the whole reason these are separate inputs.
   */
  it("a camera-scale half-life is unaffected by the cursor control", () => {
    const camera = buildCursorPath(events, { halfLifeMs: 400, sampleHz: 120 });
    expect(cursorAt(camera, 520)?.x).toBeLessThan(1000);
  });
});
