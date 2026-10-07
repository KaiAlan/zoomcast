import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { dragKindAt, pxToFrac, type DragKind } from "./geometry";

type Active = {
  id: string;
  kind: DragKind;
  startClientX: number;
  /** The region's own left edge at pointerdown, as a fraction of the track. */
  startFrac: number;
  trackWidthPx: number;
  trackLeftPx: number;
};

type Opts = {
  /** Absolute target for the region's start edge, as a track fraction. */
  onMove: (id: string, targetStartFrac: number) => void;
  /** Absolute target for the dragged edge, as a track fraction. */
  onResize: (id: string, edge: "start" | "end", tFrac: number) => void;
  onCommit: () => void;
};

/**
 * Move-and-resize for one lane's regions.
 *
 * Shared by both lanes so pointer capture is written once. Without capture a
 * drag dies the moment the cursor leaves the track, which is exactly when a
 * user is trying to push a region against an end.
 *
 * `onMove` and `onResize` both report an ABSOLUTE target, never a delta.
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
 *
 * Since task 10 that target is a TRACK FRACTION rather than output ms, which
 * is why this hook no longer takes `outputDurationMs` at all. Output ms is
 * only an absolute coordinate while the output timebase holds still. It does
 * for a zoom segment — moving or resizing one removes nothing — and it does
 * NOT for a cut: growing a cut shortens the very output duration the lane is
 * drawn against, so the same pointer pixel is a different output ms on each
 * successive pointermove. Reporting where the pointer IS, in the lane's own
 * coordinates, stays absolute under any rescale. Each lane then resolves the
 * fraction against a timebase its own edit cannot move: `ZoomLane` multiplies
 * by `outputDurationMs`, which is exact there; `CutLane` hands the fraction to
 * `cutDragToSource` / `cutResizeToSource`, which solve for the cut geometry
 * that puts the dragged edge back under that fraction after the rescale.
 *
 * `opts` is read through a ref instead of being captured into the pointermove
 * closure, so a callback always sees the latest render's props. The captured
 * version silently used pointerdown-era values for a whole gesture.
 */
export function useRegionDrag(opts: Opts) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const active = useRef<Active | null>(null);

  // Read at call time, never capture time -- see the note above.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onPointerDown = (e: ReactPointerEvent, id: string): void => {
    if (e.button !== 0) return;
    // Keeps the lane background's own pointerdown -- which clears the
    // selection, and on the cut lane starts a drag-to-create -- from firing
    // for a press that landed on a region.
    e.stopPropagation();

    cleanupRef.current?.();
    const region = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const regionBox = region.getBoundingClientRect();
    const track = region.parentElement;
    if (track === null) return;
    const trackBox = track.getBoundingClientRect();

    region.setPointerCapture(e.pointerId);
    active.current = {
      id,
      kind: dragKindAt(e.clientX - regionBox.left, regionBox.width),
      startClientX: e.clientX,
      startFrac: pxToFrac(regionBox.left - trackBox.left, trackBox.width),
      trackWidthPx: trackBox.width,
      trackLeftPx: trackBox.left,
    };

    const onPointerMove = (ev: globalThis.PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      const a = active.current;
      if (a === null) return;

      if (a.kind === "move") {
        optsRef.current.onMove(
          a.id,
          a.startFrac + pxToFrac(ev.clientX - a.startClientX, a.trackWidthPx),
        );
        return;
      }

      const tFrac = pxToFrac(ev.clientX - a.trackLeftPx, a.trackWidthPx);
      optsRef.current.onResize(a.id, a.kind === "resize-start" ? "start" : "end", tFrac);
    };

    const onPointerUp = (event: globalThis.PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      active.current = null;
      optsRef.current.onCommit();
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
  };

  return { onPointerDown };
}
