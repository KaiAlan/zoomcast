import { useLayoutEffect, useRef, useState } from "react";
import { sourceSpanToOutput, sourceToOutput } from "../../../shared/project/timeline";
import type { Cut } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import type { ZoomKeyframe, ZoomSegment } from "../../../shared/zoom/types";
import { EDGE_HIT_PX, MIN_RESIZABLE_PX, msToPct } from "./geometry";
import { useRegionDrag } from "./useRegionDrag";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  /**
   * The persisted, editable shots. Keyframes below are what renders; these are
   * what the user selects and edits.
   */
  segments: ZoomSegment[];
  keyframes: ZoomKeyframe[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Where upscaling begins. Keyframes past it are marked. */
  pixelParityZoom: number;
  /** Absolute output-ms target for the segment's start edge. See useRegionDrag. */
  onSegmentMove: (id: string, targetStartOutputMs: number) => void;
  /** Absolute output-ms target for the dragged edge. See useRegionDrag. */
  onSegmentResize: (id: string, edge: "start" | "end", tOutputMs: number) => void;
  onSegmentDragCommit: () => void;
};

const HEIGHT = 56;

function SegmentRegion({
  s,
  span,
  outputDurationMs,
  trackWidthPx,
  selected,
  follow,
  onSelect,
  drag,
}: {
  s: ZoomSegment;
  span: { startMs: number; endMs: number };
  outputDurationMs: number;
  /** The lane track's own measured width. See `ZoomLane`'s single observer. */
  trackWidthPx: number;
  selected: boolean;
  follow: boolean;
  onSelect: () => void;
  drag: ReturnType<typeof useRegionDrag>;
}) {
  // Whether the region is wide enough to grab an edge (MIN_RESIZABLE_PX)
  // depends on its rendered pixel width, but the region is laid out with a
  // percentage `width`. Rather than measure each region's own DOM node,
  // derive it from the lane's one measured `trackWidthPx` and the same
  // percentages the region is positioned with -- one observer for the whole
  // lane instead of one per segment.
  const widthPct = msToPct(span.endMs, outputDurationMs) - msToPct(span.startMs, outputDurationMs);
  const widthPx = (widthPct / 100) * trackWidthPx;
  const resizable = widthPx >= MIN_RESIZABLE_PX;

  return (
    <div
      title={`${s.id} · ${s.position}${s.waypoints.length > 1 ? ` · ${s.waypoints.length} waypoints` : ""}`}
      onPointerDown={(e) => {
        // Select the segment (never toggle it off -- a drag that starts on
        // an already-selected segment must not deselect it mid-gesture) and
        // start the drag from the same gesture. JSX allows only one
        // onPointerDown per element, so these two used-to-be-separate
        // handlers merge here.
        onSelect();
        drag.onPointerDown(e, s.id);
      }}
      style={{
        position: "absolute",
        left: `${msToPct(span.startMs, outputDurationMs)}%`,
        width: `${Math.max(0, widthPct)}%`,
        top: 4,
        bottom: 4,
        borderRadius: 4,
        boxSizing: "border-box",
        background: follow ? "rgba(122, 200, 160, 0.16)" : "rgba(106, 166, 232, 0.13)",
        border: `1px solid ${
          selected ? "#e8ecf2" : follow ? "rgba(122,200,160,0.45)" : "rgba(106,166,232,0.3)"
        }`,
        cursor: "grab",
      }}
    >
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

export function ZoomLane({
  durationMs,
  outputDurationMs,
  cuts,
  segments,
  keyframes,
  selection,
  onSelect,
  pixelParityZoom,
  onSegmentMove,
  onSegmentResize,
  onSegmentDragCommit,
}: Props) {
  const drag = useRegionDrag({
    outputDurationMs,
    onMove: onSegmentMove,
    onResize: onSegmentResize,
    onCommit: onSegmentDragCommit,
  });

  // One observer for the whole lane, not one per segment: every region's
  // pixel width is derivable from this single measurement plus the same
  // percentages it is already positioned with (see `SegmentRegion`).
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

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        height: HEIGHT,
        background: "#15171c",
        border: "1px solid #23262e",
        borderTop: "none",
        borderBottom: "none",
        overflow: "hidden",
      }}
    >
      {/*
        Shots are drawn as regions behind the keyframe markers rather than as
        their own strip. The lane is only 56px and the two marker rows already
        occupy 6-26 and 30-50, so a strip would either collide with them or be
        too thin to click. A region also says the right thing: the markers of
        a shot sit inside it.
      */}
      {segments.map((s) => {
        const span = sourceSpanToOutput(s.startMs, s.endMs, durationMs, cuts);
        if (span === null) return null;

        const selected = selection?.kind === "segment" && selection.id === s.id;
        const follow = s.position === "follow";

        return (
          <SegmentRegion
            key={s.id}
            s={s}
            span={span}
            outputDurationMs={outputDurationMs}
            trackWidthPx={trackWidthPx}
            selected={selected}
            follow={follow}
            onSelect={() => onSelect({ kind: "segment", id: s.id })}
            drag={drag}
          />
        );
      })}

      {keyframes.map((k) => {
        const out = sourceToOutput(k.tSourceMs, durationMs, cuts);
        if (out === null) return null;
        // A follow shot emits a sample every 100ms — 43 of them on a
        // four-second hold — and drawing a marker for each buries the
        // keyframes that mark an actual camera decision under a picket
        // fence. `linear` is only ever the follow sampler's easing, which
        // makes it exactly the right filter.
        if (k.easing === "linear") return null;

        const zoomed = k.scale > 1;
        // Every default zoom is past 1:1 now — the bases are 1.55 and 1.35
        // against a parity point of ~1.18 — so colouring them all would make
        // the warning the norm and the signal nil. The upscale factor goes in
        // the tooltip instead, where it is information rather than an alarm.
        const upscale = k.scale / pixelParityZoom;

        return (
          <div
            key={k.id}
            title={`${k.id} · scale ${k.scale.toFixed(3)}${upscale > 1.001 ? ` · ${upscale.toFixed(2)}× upscale` : ""}${k.pinned ? " · pinned" : ""}`}
            style={{
              position: "absolute",
              left: `${msToPct(out, outputDurationMs)}%`,
              top: zoomed ? 6 : 30,
              width: 3,
              height: 20,
              marginLeft: -1,
              borderRadius: 2,
              background: zoomed ? "#6aa6e8" : "#4a5568",
              outline: k.pinned ? "1px solid #f0f0f0" : "none",
            }}
          />
        );
      })}
    </div>
  );
}
