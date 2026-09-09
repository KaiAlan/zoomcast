import type { RefObject } from "react";
import type { Cut } from "../../shared/project/types";
import type { Selection } from "../../shared/project/history";
import type { ZoomKeyframe, ZoomSegment } from "../../shared/zoom/types";
import { Ruler } from "./timeline/Ruler";
import { ZoomLane } from "./timeline/ZoomLane";
import { CutLane } from "./timeline/CutLane";
import { msToPct } from "./timeline/geometry";

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
  selection: Selection;
  onSelect: (s: Selection) => void;
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
  selection,
  onSelect,
  playheadMs,
  playheadRef,
  pixelParityZoom,
  maxZoom,
  onSeek,
}: Props) {
  return (
    <div>
      <div style={{ position: "relative" }}>
        <Ruler outputDurationMs={outputDurationMs} onSeek={onSeek} />
        <ZoomLane
          durationMs={durationMs}
          outputDurationMs={outputDurationMs}
          cuts={cuts}
          segments={segments}
          keyframes={keyframes}
          selection={selection}
          onSelect={onSelect}
          pixelParityZoom={pixelParityZoom}
        />
        <CutLane
          durationMs={durationMs}
          outputDurationMs={outputDurationMs}
          cuts={cuts}
          selection={selection}
          onSelect={onSelect}
        />

        <div
          ref={playheadRef}
          style={{
            position: "absolute",
            left: `${msToPct(playheadMs, outputDurationMs)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "#f5f5f5",
            // The lanes below own their own pointer handling (the ruler
            // scrubs, the zoom and cut lanes select); this thin overlay must
            // not steal clicks meant for whichever lane it happens to cross.
            pointerEvents: "none",
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
