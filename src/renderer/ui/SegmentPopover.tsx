import { useEffect, useRef } from "react";
import { depthToScale } from "../../shared/zoom/keyframes";
import type { ZoomSegment } from "../../shared/zoom/types";
import { buttonInput, row, sectionHeader } from "./controls";
import { activeDepthPresetIndex, DEPTH_PRESETS } from "./segmentDepthPresets";

export { DEPTH_PRESETS };

/** The popover's fixed width, in px -- used to keep it inside the timeline. */
const WIDTH = 248;

type Props = {
  segment: ZoomSegment;
  /** `project.zoom.config.maxZoom` -- the ceiling `depthToScale` grades against. */
  maxZoom: number;
  /**
   * Where the segment's region starts, as a percentage across the timeline's
   * own width -- the same number `ZoomLane` positions the region itself with
   * (`msToPct` against output ms). Anchoring on this rather than measuring the
   * region's DOM node keeps this component independent of `ZoomLane`'s
   * internals.
   */
  leftPct: number;
  /**
   * The timeline's own wrapping element. A pointerdown inside it is left
   * alone here -- see the outside-pointerdown effect below for why.
   */
  timelineRef: React.RefObject<HTMLElement | null>;
  onDepthChange: (id: string, depth: number) => void;
  onCameraChange: (id: string, position: ZoomSegment["position"]) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  onDismiss: () => void;
};

/**
 * The per-shot editor: spec §11's Shot half, floated next to the segment it
 * edits instead of living in the Inspector's fixed sidebar.
 *
 * Positioned with plain percentage math against the timeline's width, not a
 * measurement of the segment's own DOM node -- there is no floating-ui here,
 * and `ZoomLane` already computes that same percentage to lay the region out,
 * so mirroring the formula is exact and needs no ref into a sibling
 * component's internals.
 */
export function SegmentPopover({
  segment,
  maxZoom,
  leftPct,
  timelineRef,
  onDepthChange,
  onCameraChange,
  onDelete,
  onReset,
  onDismiss,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };

    /**
     * Dismiss on a pointerdown outside the popover -- except inside the
     * timeline, which task 9/10 already wired for selection: a click there
     * either selects something else or clears the selection through the
     * lanes' own empty-space deselect, and either outcome unmounts this
     * popover on the next render because `selectedSegment` resolves to
     * something else or to null. Calling `onDismiss` here too would race
     * that state update -- both handlers fire off the same native event, and
     * if this one lands second it would null out a selection the lane just
     * set to a *different* segment.
     */
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (timelineRef.current?.contains(target)) return;
      onDismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss, timelineRef]);

  const depth = segment.waypoints[0]?.depth ?? 0;
  const scale = depthToScale(depth, maxZoom);
  const activeIndex = activeDepthPresetIndex(depth);
  const seconds = (segment.endMs - segment.startMs) / 1000;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        // Clamped so the fixed-width popover never overshoots the timeline's
        // own edges, even for a shot right at the start or end of the take.
        left: `clamp(0px, ${leftPct}%, calc(100% - ${WIDTH}px))`,
        bottom: "100%",
        marginBottom: 8,
        width: WIDTH,
        background: "#181b21",
        border: "1px solid #2a2e38",
        borderRadius: 6,
        padding: 12,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
        zIndex: 10,
      }}
    >
      <div style={{ ...sectionHeader, ...row, padding: 0, marginBottom: 10 }}>
        <span>shot</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{scale.toFixed(2)}×</span>
      </div>

      <div style={{ display: "flex", marginBottom: 8 }}>
        {(["fixed", "follow"] as const).map((pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => onCameraChange(segment.id, pos)}
            style={{
              ...buttonInput,
              flex: 1,
              borderRadius: 0,
              opacity: segment.position === pos ? 1 : 0.5,
              borderColor: segment.position === pos ? "#5a6272" : "#2a2e38",
            }}
          >
            {pos}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 10 }}>
        {segment.position === "fixed" ? "holds this framing" : "tracks the cursor"}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {DEPTH_PRESETS.map((preset, i) => (
          <button
            key={preset}
            type="button"
            onClick={() => onDepthChange(segment.id, preset)}
            title={`${depthToScale(preset, maxZoom).toFixed(2)}×`}
            style={{
              ...buttonInput,
              flex: 1,
              padding: "4px 0",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              opacity: i === activeIndex ? 1 : 0.5,
              borderColor: i === activeIndex ? "#5a6272" : "#2a2e38",
            }}
          >
            {depthToScale(preset, maxZoom).toFixed(2)}
          </button>
        ))}
      </div>

      <div
        style={{
          fontSize: 12,
          opacity: 0.45,
          marginBottom: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {seconds.toFixed(1)}s ·{" "}
        {segment.waypoints.length === 1
          ? "1 waypoint"
          : `${segment.waypoints.length} waypoints`}
      </div>

      <div style={{ ...row, padding: 0 }}>
        <button
          type="button"
          style={{ ...buttonInput, fontSize: 12 }}
          onClick={() => onReset(segment.id)}
        >
          reset to auto
        </button>
        <button
          type="button"
          style={{ ...buttonInput, fontSize: 12 }}
          onClick={() => onDelete(segment.id)}
        >
          delete
        </button>
      </div>
    </div>
  );
}
