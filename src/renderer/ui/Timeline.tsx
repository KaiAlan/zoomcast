import { useState, type RefObject } from "react";
import { sourceSpanToOutput, sourceToOutput } from "../../shared/project/timeline";
import type { Cut } from "../../shared/project/types";
import type { ZoomKeyframe, ZoomSegment } from "../../shared/zoom/types";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  keyframes: ZoomKeyframe[];
  /**
   * The persisted, editable shots. Keyframes above are what renders; these are
   * what the user selects and edits.
   */
  segments: ZoomSegment[];
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  playheadMs: number;
  /**
   * The marker element. The Editor moves it directly during playback rather
   * than re-rendering this component sixty times a second; `playheadMs` is
   * still the truth for the readout and for the position at mount.
   */
  playheadRef: RefObject<HTMLDivElement | null>;
  /** Where upscaling begins. Keyframes past it are marked. */
  pixelParityZoom: number;
  /** The configured cap. Since 2026-09-07 these are different numbers. */
  maxZoom: number;
  onSeek: (tOutputMs: number) => void;
};

const HEIGHT = 78;


function fmt(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = (total % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export function Timeline({
  durationMs,
  outputDurationMs,
  cuts,
  keyframes,
  segments,
  selectedSegmentId,
  onSelectSegment,
  playheadMs,
  playheadRef,
  pixelParityZoom,
  maxZoom,
  onSeek,
}: Props) {
  const [scrubbing, setScrubbing] = useState(false);

  const pct = (tOutput: number): number =>
    outputDurationMs === 0 ? 0 : (tOutput / outputDurationMs) * 100;

  /** Map a pointer position on the track to an output time. */
  const seekTo = (clientX: number, el: HTMLElement): void => {
    const box = el.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    onSeek(Math.max(0, Math.min(1, ratio)) * outputDurationMs);
  };

  const ticks: number[] = [];
  const step = outputDurationMs > 20_000 ? 5000 : 1000;
  for (let t = 0; t <= outputDurationMs; t += step) ticks.push(t);

  return (
    <div>
      <div
        style={{
          position: "relative",
          height: HEIGHT,
          background: "#15171c",
          border: "1px solid #23262e",
          borderRadius: 6,
          cursor: "pointer",
          overflow: "hidden",
        }}
        onPointerDown={(e) => {
          // Pointer capture keeps the scrub alive when the cursor leaves the
          // track, which is what makes dragging past either end feel normal.
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrubbing(true);
          seekTo(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (scrubbing) seekTo(e.clientX, e.currentTarget);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setScrubbing(false);
        }}
        onPointerCancel={() => setScrubbing(false)}
      >
        {ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              left: `${pct(t)}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: "#23262e",
            }}
          />
        ))}

        {/*
          Shots are drawn as regions behind the keyframe markers rather than as
          their own strip. The track is only 78px and the two marker rows
          already occupy 10-34 and 44-68, so a strip would either collide with
          them or be too thin to click. A region also says the right thing: the
          markers of a shot sit inside it.
        */}
        {segments.map((s) => {
          const span = sourceSpanToOutput(s.startMs, s.endMs, durationMs, cuts);
          if (span === null) return null;

          const selected = s.id === selectedSegmentId;
          const follow = s.position === "follow";

          return (
            <div
              key={s.id}
              title={`${s.id} · ${s.position}${s.waypoints.length > 1 ? ` · ${s.waypoints.length} waypoints` : ""}`}
              onPointerDown={(e) => {
                // Without this the track's own handler scrubs to the click,
                // so selecting a shot would always move the playhead too.
                e.stopPropagation();
                onSelectSegment(selected ? null : s.id);
              }}
              style={{
                position: "absolute",
                left: `${pct(span.startMs)}%`,
                width: `${Math.max(0, pct(span.endMs) - pct(span.startMs))}%`,
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
                left: `${pct(out)}%`,
                top: zoomed ? 10 : 44,
                width: 3,
                height: 24,
                marginLeft: -1,
                borderRadius: 2,
                background: zoomed ? "#6aa6e8" : "#4a5568",
                outline: k.pinned ? "1px solid #f0f0f0" : "none",
              }}
            />
          );
        })}

        <div
          ref={playheadRef}
          style={{
            position: "absolute",
            left: `${pct(playheadMs)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#f5f5f5",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          opacity: 0.6,
          marginTop: 6,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{fmt(playheadMs)}</span>
        <span>
          {/*
            Segments, not keyframes. A follow shot is one zoom that emits
            dozens of keyframes, so counting keyframes reported "33 zooms" for
            a five-second fixture holding a single shot.
          */}
          {segments.length} zooms · {cuts.length} cuts ·
          max {maxZoom.toFixed(2)}× · sharp to {pixelParityZoom.toFixed(2)}×
          {segments.some((s) => s.position === "follow")
            ? ` · ${segments.filter((s) => s.position === "follow").length} following`
            : ""}
        </span>
        <span>{fmt(outputDurationMs)}</span>
      </div>
    </div>
  );
}
