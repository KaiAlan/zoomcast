import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { dragKindAt, pxToMs, type DragKind } from "./geometry";

type Active = {
  id: string;
  kind: DragKind;
  startClientX: number;
  /** The region's own left edge at pointerdown, in output ms. */
  startOutputMs: number;
  trackWidthPx: number;
  trackLeftPx: number;
};

/**
 * Move-and-resize for one lane's regions.
 *
 * Shared by both lanes so pointer capture is written once. Without capture a
 * drag dies the moment the cursor leaves the track, which is exactly when a
 * user is trying to push a region against an end.
 *
 * `onMove` and `onResize` both report ABSOLUTE output times, never a delta.
 * The reason is `applyTransient` (see `useProjectHistory.step`): every
 * intermediate call re-applies `fn` to the CURRENT present, not to a
 * preserved pre-drag base, because `history.beginOrExtend` replaces
 * `present` wholesale while a gesture is open. A callback reporting a delta
 * measured from pointerdown would therefore have that same total delta
 * re-applied on top of a project that already moved by the previous total —
 * deltas would compound and the region would fly out from under the cursor.
 * Reporting an absolute target instead makes every application idempotent:
 * re-applying the same target to an already-moved project is a no-op. It
 * also means clamping cannot bank a rejected movement — a segment held
 * against a neighbour has its next step measured fresh from the clamped
 * position toward the same absolute target, so it does not leap when dragged
 * back the other way.
 */
export function useRegionDrag(opts: {
  outputDurationMs: number;
  onMove: (id: string, targetStartOutputMs: number) => void;
  onResize: (id: string, edge: "start" | "end", tOutputMs: number) => void;
  onCommit: () => void;
}) {
  const active = useRef<Active | null>(null);

  const onPointerDown = (e: ReactPointerEvent, id: string): void => {
    // Harmless today: after task 8 the Ruler is a sibling lane, not an
    // ancestor, so there is no bubbling path from a region to the scrub
    // handler for this to guard against. Kept for whatever nests next.
    e.stopPropagation();

    const region = e.currentTarget as HTMLElement;
    const regionBox = region.getBoundingClientRect();
    const track = region.parentElement;
    if (track === null) return;
    const trackBox = track.getBoundingClientRect();

    region.setPointerCapture(e.pointerId);
    active.current = {
      id,
      kind: dragKindAt(e.clientX - regionBox.left, regionBox.width),
      startClientX: e.clientX,
      startOutputMs: pxToMs(regionBox.left - trackBox.left, trackBox.width, opts.outputDurationMs),
      trackWidthPx: trackBox.width,
      trackLeftPx: trackBox.left,
    };

    const onPointerMove = (ev: globalThis.PointerEvent): void => {
      const a = active.current;
      if (a === null) return;

      if (a.kind === "move") {
        opts.onMove(
          a.id,
          a.startOutputMs + pxToMs(ev.clientX - a.startClientX, a.trackWidthPx, opts.outputDurationMs),
        );
        return;
      }

      const tOutputMs = pxToMs(ev.clientX - a.trackLeftPx, a.trackWidthPx, opts.outputDurationMs);
      opts.onResize(a.id, a.kind === "resize-start" ? "start" : "end", tOutputMs);
    };

    const onPointerUp = (): void => {
      active.current = null;
      opts.onCommit();
      region.removeEventListener("pointermove", onPointerMove);
      region.removeEventListener("pointerup", onPointerUp);
      region.removeEventListener("pointercancel", onPointerUp);
    };

    region.addEventListener("pointermove", onPointerMove);
    region.addEventListener("pointerup", onPointerUp);
    region.addEventListener("pointercancel", onPointerUp);
  };

  return { onPointerDown };
}
