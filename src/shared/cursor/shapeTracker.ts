import type { CursorShape, TelemetryEvent } from "../bundle/types";

export type ShapeTable = Map<number, CursorShape>;

export type ShapeTracker = {
  observe(t: number, handle: number, visible: boolean): TelemetryEvent | null;
};

/**
 * Turn a stream of raw cursor handles into shape-change events.
 *
 * Polling runs at 30Hz but the shape changes a handful of times a minute, so
 * only transitions are written. An unknown handle means a bespoke application
 * cursor; "arrow" is the honest approximation.
 */
export function createShapeTracker(table: ShapeTable): ShapeTracker {
  let last: CursorShape | null = null;

  return {
    observe(t, handle, visible) {
      const shape: CursorShape = visible ? (table.get(handle) ?? "arrow") : "arrow";
      if (shape === last) return null;
      last = shape;
      return { t, k: "cursor", shape };
    },
  };
}
