import { describe, expect, it } from "vitest";
import { createShapeTracker } from "./shapeTracker";

const table = new Map([
  [100, "arrow" as const],
  [200, "ibeam" as const],
  [300, "hand" as const],
]);

describe("createShapeTracker", () => {
  it("emits an event for the first shape it sees", () => {
    const tracker = createShapeTracker(table);
    expect(tracker.observe(0, 100, true)).toEqual({ t: 0, k: "cursor", shape: "arrow" });
  });

  it("suppresses a repeat of the same shape", () => {
    const tracker = createShapeTracker(table);
    tracker.observe(0, 100, true);
    expect(tracker.observe(33, 100, true)).toBeNull();
  });

  it("emits again when the shape changes", () => {
    const tracker = createShapeTracker(table);
    tracker.observe(0, 100, true);
    expect(tracker.observe(33, 200, true)).toEqual({ t: 33, k: "cursor", shape: "ibeam" });
  });

  it("falls back to arrow for a handle it does not know", () => {
    const tracker = createShapeTracker(table);
    expect(tracker.observe(0, 999, true)).toEqual({ t: 0, k: "cursor", shape: "arrow" });
  });

  it("treats a hidden cursor as a shape change back to arrow", () => {
    // A suppressed cursor (full-screen video, some games) must not leave the
    // last shape latched forever.
    const tracker = createShapeTracker(table);
    tracker.observe(0, 200, true);
    expect(tracker.observe(33, 200, false)).toEqual({ t: 33, k: "cursor", shape: "arrow" });
  });
});
