import { sourceSpanToOutput, sourceToOutput } from "../../../shared/project/timeline";
import type { Cut } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import type { ZoomKeyframe, ZoomSegment } from "../../../shared/zoom/types";
import { msToPct } from "./geometry";

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
};

const HEIGHT = 56;

export function ZoomLane({
  durationMs,
  outputDurationMs,
  cuts,
  segments,
  keyframes,
  selection,
  onSelect,
  pixelParityZoom,
}: Props) {
  return (
    <div
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
          <div
            key={s.id}
            title={`${s.id} · ${s.position}${s.waypoints.length > 1 ? ` · ${s.waypoints.length} waypoints` : ""}`}
            onPointerDown={() => {
              onSelect(selected ? null : { kind: "segment", id: s.id });
            }}
            style={{
              position: "absolute",
              left: `${msToPct(span.startMs, outputDurationMs)}%`,
              width: `${Math.max(0, msToPct(span.endMs, outputDurationMs) - msToPct(span.startMs, outputDurationMs))}%`,
              top: 4,
              bottom: 4,
              borderRadius: 4,
              boxSizing: "border-box",
              background: follow
                ? "rgba(122, 200, 160, 0.16)"
                : "rgba(106, 166, 232, 0.13)",
              border: `1px solid ${
                selected ? "#e8ecf2" : follow ? "rgba(122,200,160,0.45)" : "rgba(106,166,232,0.3)"
              }`,
              cursor: "pointer",
            }}
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
