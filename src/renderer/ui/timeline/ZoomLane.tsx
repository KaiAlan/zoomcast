import { useTrackWidth } from "./useTrackWidth";
import { Icon } from "../Icon";
import { sourceSpansToOutput, sourceToOutput } from "../../../shared/project/timeline";
import type { Cut, SourceClip } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import type { ZoomKeyframe, ZoomSegment } from "../../../shared/zoom/types";
import { EDGE_HIT_PX, MIN_RESIZABLE_PX, msToPct } from "./geometry";
import { useRegionDrag } from "./useRegionDrag";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  clips?: SourceClip[];
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
    <button type="button"
      data-segment-id={s.id}
      aria-label={`${follow ? "Follow cursor" : "Fixed"} zoom at ${(span.startMs / 1000).toFixed(1)} seconds`}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`timeline-segment ${selected ? "is-selected" : ""}`}
      title={`${s.id} · ${s.position}${s.waypoints.length > 1 ? ` · ${s.waypoints.length} waypoints` : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
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
        borderRadius: 9,
        boxSizing: "border-box",
        background: "var(--zoom-block)",
        border: `1px solid ${
          selected ? "var(--zoom-edge-selected)" : "var(--zoom-edge)"
        }`,
        cursor: "grab",
      }}
    >
      <span className="timeline-segment-label"><Icon name="zoom" size={16} />{widthPx > 95 && <span>{follow ? "Follow" : "Zoom"}</span>}</span>
      {resizable && (
        <>
          <span
            className="timeline-region-handle"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: EDGE_HIT_PX,
              cursor: "ew-resize",
            }}
          />
          <span
            className="timeline-region-handle"
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
    </button>
  );
}

export function ZoomLane({
  durationMs,
  outputDurationMs,
  cuts,
  clips,
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
    // The hook reports lane fractions; segments are edited in output ms.
    // Multiplying here is exact, because neither moving nor resizing a segment
    // removes anything -- `outputDurationMs` is the same number at the end of
    // the gesture as at pointerdown, so the fraction and the ms are two names
    // for one position. `CutLane` is precisely the lane that cannot say that.
    onMove: (id, targetStartFrac) => onSegmentMove(id, targetStartFrac * outputDurationMs),
    onResize: (id, edge, tFrac) => onSegmentResize(id, edge, tFrac * outputDurationMs),
    onCommit: onSegmentDragCommit,
  });

  // One observer for the whole lane, not one per segment: every region's
  // pixel width is derivable from this single measurement plus the same
  // percentages it is already positioned with (see `SegmentRegion`).
  const { trackRef, trackWidthPx } = useTrackWidth();

  return (
    <div
      className="timeline-zoom-lane"
      ref={trackRef}
      // Empty lane space clears the selection. Task 9 took toggle-off away
      // from the region itself -- a drag starting on an already-selected
      // segment must not deselect it mid-gesture -- and handed deselection to
      // a click on empty space. That has to exist in THIS lane too: with it
      // only on the cut lane, dropping a segment selection would mean clicking
      // empty space in a different lane, which nobody would find. A region's
      // pointerdown stops propagation, and the guard keeps a press on a
      // keyframe marker from counting as background.
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.target === e.currentTarget) onSelect(null);
      }}
      style={{
        position: "relative",
        height: HEIGHT,
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
      {segments.flatMap((s) => sourceSpansToOutput(s.startMs, s.endMs, durationMs, cuts, clips).map((span) => {

        const host = clips?.find(c => s.startMs < c.endMs && s.endMs > c.startMs
          && sourceToOutput(Math.max(s.startMs, c.startMs), durationMs, cuts, clips) === span.startMs);
        const selected = selection?.kind === "segment" && selection.id === s.id;
        const follow = s.position === "follow";

        return (
          <SegmentRegion
            key={`${s.id}-${host?.id ?? "whole"}`}
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
      }))}

      {keyframes.map((k) => {
        const out = sourceToOutput(k.tSourceMs, durationMs, cuts, clips);
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
            className="timeline-keyframe"
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
              outline: k.pinned ? "1px solid var(--accent)" : "none",
            }}
          />
        );
      })}
    </div>
  );
}
