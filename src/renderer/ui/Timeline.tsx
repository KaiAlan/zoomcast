import type { CSSProperties, RefObject } from "react";
import type { Cut } from "../../shared/project/types";
import type { Selection } from "../../shared/project/history";
import type { ZoomKeyframe, ZoomSegment } from "../../shared/zoom/types";
import { Ruler, rulerStep } from "./timeline/Ruler";
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
  /** Absolute output-ms target for the segment's start edge. See useRegionDrag. */
  onSegmentMove: (id: string, targetStartOutputMs: number) => void;
  /** Absolute output-ms target for the dragged edge. See useRegionDrag. */
  onSegmentResize: (id: string, edge: "start" | "end", tOutputMs: number) => void;
  onSegmentDragCommit: () => void;
  /**
   * Both edges of a drag-to-create, as absolute lane fractions in either
   * order. Cut callbacks are fractions where the segment ones are output ms:
   * a cut edit moves the output timebase the drag is measured in, so output ms
   * is not an absolute coordinate for the length of the gesture. See
   * `useRegionDrag`.
   */
  onCreateCut: (aFrac: number, bFrac: number) => void;
  /** Absolute lane fraction for the cut's seam. */
  onCutMove: (id: string, targetStartFrac: number) => void;
  /** Absolute lane fraction for the dragged edge. */
  onCutResize: (id: string, edge: "start" | "end", tFrac: number) => void;
  onCutDragCommit: () => void;
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
  onSegmentMove,
  onSegmentResize,
  onSegmentDragCommit,
  onCreateCut,
  onCutMove,
  onCutResize,
  onCutDragCommit,
}: Props) {
  return (
    <div className="timeline-content">

      <div className="timeline-tracks" style={{ position: "relative", "--timeline-grid": `${rulerStep(outputDurationMs) / Math.max(1, outputDurationMs) * 100}%` } as CSSProperties}>
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
          onSegmentMove={onSegmentMove}
          onSegmentResize={onSegmentResize}
          onSegmentDragCommit={onSegmentDragCommit}
        />
        <CutLane
          durationMs={durationMs}
          outputDurationMs={outputDurationMs}
          cuts={cuts}
          selection={selection}
          onSelect={onSelect}
          onCreateCut={onCreateCut}
          onCutMove={onCutMove}
          onCutResize={onCutResize}
          onCutDragCommit={onCutDragCommit}
        />

        <div
          className="timeline-playhead"
          ref={playheadRef}
          style={{
            position: "absolute",
            left: `${msToPct(playheadMs, outputDurationMs)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            marginLeft: -1,
            background: "var(--accent)",
            // The lanes below own their own pointer handling (the ruler
            // scrubs, the zoom and cut lanes select); this thin overlay must
            // not steal clicks meant for whichever lane it happens to cross.
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        className="timeline-footer"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>2 tracks · {segments.length} segments · {cuts.length} cuts</span>
        <span>
          Drag to move · Pull edges to resize · Drag the trim track to cut
        </span>
        <span title={`Max zoom ${maxZoom.toFixed(2)}× · Sharp to ${pixelParityZoom.toFixed(2)}×`}>{fmt(playheadMs)} / {fmt(outputDurationMs)}</span>
      </div>
    </div>
  );
}
