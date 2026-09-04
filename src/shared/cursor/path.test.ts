import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { buildCursorPath, cursorAt } from "./path";

const opts = { smoothing: 0.8, sampleHz: 120 };

describe("buildCursorPath", () => {
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
    // Critically damped, not underdamped — an overshooting cursor looks broken.
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
    const s = cursorAt(buildCursorPath(events, { smoothing: 0, sampleHz: 120 }), 500);
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

  it("reports pressed between a down and its up", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 100, k: "down", x: 0, y: 0, b: 1 },
      { t: 300, k: "up", x: 0, y: 0, b: 1 },
      { t: 500, k: "move", x: 0, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    expect(cursorAt(path, 200)?.pressed).toBe(true);
    expect(cursorAt(path, 400)?.pressed).toBe(false);
  });
});
