import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MIN_CUT_MS } from "../../../shared/project/edits";
import { sourceSpanToOutput } from "../../../shared/project/timeline";
import type { Cut } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import { EDGE_HIT_PX, MIN_RESIZABLE_PX, msToPct, pxToFrac } from "./geometry";
import { useRegionDrag } from "./useRegionDrag";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Both edges as absolute lane fractions, in either order. See useRegionDrag. */
  onCreateCut: (aFrac: number, bFrac: number) => void;
  /** Absolute lane fraction for the cut's seam. See useRegionDrag. */
  onCutMove: (id: string, targetStartFrac: number) => void;
  /** Absolute lane fraction for the dragged edge. See useRegionDrag. */
  onCutResize: (id: string, edge: "start" | "end", tFrac: number) => void;
  onCutDragCommit: () => void;
};

const HEIGHT = 20;

/** The stripe marking where the material actually went. See `CutRegion`. */
const SEAM_PX = 2;

function CutRegion({
  c,
  span,
  outputDurationMs,
  trackWidthPx,
  selected,
  onSelect,
  drag,
}: {
  c: Cut;
  span: { startMs: number; endMs: number };
  outputDurationMs: number;
  /** The lane track's own measured width. See `CutLane`'s single observer. */
  trackWidthPx: number;
  selected: boolean;
  onSelect: () => void;
  drag: ReturnType<typeof useRegionDrag>;
}) {
  const startPct = msToPct(span.startMs, outputDurationMs);
  const widthPct = msToPct(span.endMs, outputDurationMs) - startPct;
  const resizable = (widthPct / 100) * trackWidthPx >= MIN_RESIZABLE_PX;

  return (
    <div
      title={`${c.id} · ${((c.endMs - c.startMs) / 1000).toFixed(2)}s removed here`}
      onPointerDown={(e) => {
        // Select without toggling off, then start the drag from the same
        // gesture -- as `SegmentRegion` does, for the same reason: a drag
        // beginning on an already-selected region must not deselect it
        // mid-gesture. Deselection belongs to the lane background below.
        onSelect();
        drag.onPointerDown(e, c.id);
      }}
      style={{
        position: "absolute",
        left: `${startPct}%`,
        width: `${Math.max(0, widthPct)}%`,
        top: 2,
        bottom: 2,
        borderRadius: 3,
        boxSizing: "border-box",
        background:
          "repeating-linear-gradient(45deg, rgba(232,140,110,0.28) 0, rgba(232,140,110,0.28) 3px, transparent 3px, transparent 7px)",
        border: `1px solid ${selected ? "#e8ecf2" : "rgba(232,140,110,0.5)"}`,
        cursor: "grab",
      }}
    >
      {/*
        The seam. A cut is rippled OUT of output time, so its true output
        footprint is this zero-width instant and nothing else: everything to
        the right of this stripe is output time carrying real surviving
        footage, which the zoom lane above correctly draws as live. A region
        here means "the material removed at this seam", NOT "this output range
        is cut" -- it is drawn with width because spec §6 asks for a region and
        because resizing needs MIN_RESIZABLE_PX of something to grab. The
        stripe is what keeps the position unambiguous even though the width is
        not.
      */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -1,
          bottom: -1,
          width: SEAM_PX,
          background: "#e88c6e",
          borderRadius: "2px 0 0 2px",
          pointerEvents: "none",
        }}
      />
      {resizable && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: EDGE_HIT_PX,
              cursor: "ew-resize",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: EDGE_HIT_PX,
              cursor: "ew-resize",
            }}
          />
        </>
      )}
    </div>
  );
}

export function CutLane({
  durationMs,
  outputDurationMs,
  cuts,
  selection,
  onSelect,
  onCreateCut,
  onCutMove,
  onCutResize,
  onCutDragCommit,
}: Props) {
  const drag = useRegionDrag({
    // Fractions, unconverted. Unlike `ZoomLane` this lane cannot turn a
    // pointer position into an output ms and be done: the edit the drag is
    // making changes `outputDurationMs` itself. `cutDragToSource` and
    // `cutResizeToSource` resolve the fraction against a timebase the edit
    // cannot move -- see their doc comments.
    onMove: onCutMove,
    onResize: onCutResize,
    onCommit: onCutDragCommit,
  });

  // One observer for the whole lane, not one per cut: every region's pixel
  // width follows from this single measurement and the percentages it is
  // already positioned with. Same arrangement as `ZoomLane`.
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidthPx, setTrackWidthPx] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (el === null) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setTrackWidthPx(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The provisional region a drag-to-create paints. Kept in a ref as well as
  // state because pointerup reads it from a listener, not from a render.
  const [draft, setDraft] = useState<{ aFrac: number; bFrac: number } | null>(null);
  const draftRef = useRef<{ aFrac: number; bFrac: number } | null>(null);
  const setBoth = (d: { aFrac: number; bFrac: number } | null): void => {
    draftRef.current = d;
    setDraft(d);
  };

  /**
   * Empty lane space: clear the selection, and drag out a new cut.
   *
   * A region's own pointerdown stops propagation, so this only ever sees a
   * press that landed on the background; the `currentTarget` guard covers the
   * provisional region too, which is `pointerEvents: none` regardless.
   *
   * Nothing here is transient. Creating a cut is one discrete edit made on
   * pointerup, so the callback goes through `apply` rather than the
   * `applyTransient` path the region drags use.
   */
  const onBackgroundPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;

    // Deselect on press rather than on release: a click on empty space is the
    // documented way to drop a selection (in this lane and in `ZoomLane`), and
    // a drag that goes on to author a cut should not leave the old selection
    // standing behind it either.
    onSelect(null);

    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return;

    const fracAt = (clientX: number): number =>
      Math.max(0, Math.min(1, pxToFrac(clientX - box.left, box.width)));

    const aFrac = fracAt(e.clientX);
    el.setPointerCapture(e.pointerId);
    setBoth({ aFrac, bFrac: aFrac });

    const stop = (): void => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerMove = (ev: globalThis.PointerEvent): void => {
      setBoth({ aFrac, bFrac: fracAt(ev.clientX) });
    };

    const onPointerUp = (): void => {
      const d = draftRef.current;
      setBoth(null);
      stop();
      if (d === null) return;

      const lo = Math.min(d.aFrac, d.bFrac);
      const hi = Math.max(d.aFrac, d.bFrac);
      // Here only so a click does not spend an undo slot on a no-op edit. The
      // floor itself is enforced inside `createCutFromDrag`, where it is pure,
      // tested, and the invariant `addCut` does not carry.
      if ((hi - lo) * outputDurationMs < MIN_CUT_MS) return;
      onCreateCut(lo, hi);
    };

    // A cancelled gesture is an abort, not a short drag: it creates nothing.
    const onPointerCancel = (): void => {
      setBoth(null);
      stop();
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={onBackgroundPointerDown}
      style={{
        position: "relative",
        height: HEIGHT,
        background: "#15171c",
        border: "1px solid #23262e",
        borderTop: "none",
        borderRadius: "0 0 6px 6px",
        overflow: "hidden",
        cursor: "crosshair",
      }}
    >
      {cuts.map((c) => {
        // A cut is fully rippled out of `outputDurationMs`, so mapping its own
        // span through the full `cuts` list swallows it whole (that is what
        // `sourceSpanToOutput` does with a span a cut entirely covers). What
        // the lane needs instead is where that removed span sits net of every
        // *other* cut's ripple — the gap this cut left behind.
        const others = cuts.filter((x) => x.id !== c.id);
        const span = sourceSpanToOutput(c.startMs, c.endMs, durationMs, others);
        if (span === null) return null;

        return (
          <CutRegion
            key={c.id}
            c={c}
            span={span}
            outputDurationMs={outputDurationMs}
            trackWidthPx={trackWidthPx}
            selected={selection?.kind === "cut" && selection.id === c.id}
            onSelect={() => onSelect({ kind: "cut", id: c.id })}
            drag={drag}
          />
        );
      })}

      {draft !== null && (
        <div
          style={{
            position: "absolute",
            left: `${Math.min(draft.aFrac, draft.bFrac) * 100}%`,
            width: `${Math.abs(draft.bFrac - draft.aFrac) * 100}%`,
            top: 2,
            bottom: 2,
            borderRadius: 3,
            boxSizing: "border-box",
            background: "rgba(232,140,110,0.16)",
            border: "1px dashed rgba(232,140,110,0.8)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
