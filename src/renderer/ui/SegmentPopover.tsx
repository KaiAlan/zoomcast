import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { depthToScale } from "../../shared/zoom/keyframes";
import type { ZoomSegment } from "../../shared/zoom/types";
import { Icon } from "./Icon";
import { SliderField } from "./SliderField";
import { activeDepthPresetIndex, DEPTH_PRESETS } from "./segmentDepthPresets";

export { DEPTH_PRESETS };

/** The popover's fixed width, in px -- used to keep it inside the viewport. */
const WIDTH = 280;

type Props = {
  segment: ZoomSegment;
  /** `project.zoom.config.maxZoom` -- the ceiling `depthToScale` grades against. */
  maxZoom: number;
  timelineRef: React.RefObject<HTMLElement | null>;
  layoutVersion: string;
  onDepthChange: (id: string, depth: number) => void;
  onCameraChange: (id: string, position: ZoomSegment["position"]) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  onDismiss: () => void;
};

export function SegmentPopover({
  segment,
  maxZoom,
  layoutVersion,
  timelineRef,
  onDepthChange,
  onCameraChange,
  onDelete,
  onReset,
  onDismiss,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll and timeline scale change the anchor position without changing its identity.
  useLayoutEffect(() => {
    const anchor = [...(timelineRef.current?.querySelectorAll<HTMLElement>("[data-segment-id]") ?? [])]
      .find(el => el.dataset.segmentId === segment.id);
    const viewport = timelineRef.current?.querySelector(".timeline-viewport");
    if (!anchor || !viewport || !ref.current) return;
    const update = () => {
      const box = anchor.getBoundingClientRect();
      const visible = viewport.getBoundingClientRect();
      const popup = ref.current?.getBoundingClientRect();
      const width = popup?.width ?? WIDTH;
      const height = popup?.height ?? 360;
      const anchorX = Math.max(visible.left, Math.min(visible.right, box.left));
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, anchorX));
      const toolbarTop = timelineRef.current?.getBoundingClientRect().top ?? box.top;
      const above = Math.min(box.top, toolbarTop) - height - 10;
      const top = Math.max(12, Math.min(window.innerHeight - height - 12, above >= 12 ? above : box.bottom + 10));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [segment.id, timelineRef, layoutVersion]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onDismiss();
    };

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-segment-id]")) return;
      onDismiss();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onDismiss]);

  const depth = segment.waypoints[0]?.depth ?? 0;
  const scale = depthToScale(depth, maxZoom);
  const activeIndex = activeDepthPresetIndex(depth);
  const seconds = (segment.endMs - segment.startMs) / 1000;

  return createPortal(
    <div ref={ref} className="segment-popover" role="dialog" aria-label="Zoom segment controls"
      style={{ ...position, width: WIDTH }}>
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
    </div>, document.body
  );
}
