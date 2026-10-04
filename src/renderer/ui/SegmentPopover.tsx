import { useEffect, useRef } from "react";
import { depthToScale } from "../../shared/zoom/keyframes";
import type { ZoomSegment } from "../../shared/zoom/types";
import { Icon } from "./Icon";
import { SliderField } from "./SliderField";
import { activeDepthPresetIndex, DEPTH_PRESETS } from "./segmentDepthPresets";

export { DEPTH_PRESETS };

/** The popover's fixed width, in px -- used to keep it inside the timeline. */
const WIDTH = 280;

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
    <div ref={ref} className="segment-popover" role="dialog" aria-label="Zoom segment controls"
      style={{ left: `clamp(0px, ${leftPct}%, calc(100% - ${WIDTH}px))`, width: WIDTH }}>
      <header className="segment-popover-header"><span><Icon name="zoom" size={17} />Zoom segment</span><button type="button" className="icon-button" aria-label="Close zoom controls" onClick={onDismiss}><Icon name="close" size={15} /></button></header>
      <fieldset className="segmented-control segment-camera"><legend className="sr-only">Camera behavior</legend>
        {(["fixed", "follow"] as const).map(position => <button key={position} type="button" aria-label={`${position === "fixed" ? "Fixed" : "Follow"} camera`} aria-pressed={segment.position === position} onClick={() => onCameraChange(segment.id, position)}>{position === "fixed" ? "Fixed" : "Follow cursor"}</button>)}
      </fieldset>
      <p className="segment-camera-help">{segment.position === "fixed" ? "Keeps the camera focused on this area." : "Holds this area, then pans when your cursor moves toward the edge."}</p>
      <SliderField label="Zoom amount" unit="×" min={1} max={Math.max(1, maxZoom)} step={0.05} value={Number(scale.toFixed(2))} onChange={value => onDepthChange(segment.id, maxZoom > 1 ? (value - 1) / (maxZoom - 1) : 0)} />
      <fieldset className="segment-depth-presets"><legend className="sr-only">Zoom presets</legend>
        {DEPTH_PRESETS.map((preset, i) => <button key={preset} type="button" aria-pressed={i === activeIndex} onClick={() => onDepthChange(segment.id, preset)}>{depthToScale(preset, maxZoom).toFixed(2)}×</button>)}
      </fieldset>
      <p className="segment-popover-meta">{seconds.toFixed(1)} seconds · {segment.waypoints.length} {segment.waypoints.length === 1 ? "focus point" : "focus points"}</p>
      <footer className="segment-popover-actions"><button type="button" onClick={() => onReset(segment.id)}><Icon name="restart" size={14} />Reset to auto</button><button type="button" className="segment-delete" onClick={() => onDelete(segment.id)}><Icon name="trash" size={14} />Delete</button></footer>
    </div>
  );
}
