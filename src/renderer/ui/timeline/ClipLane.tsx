import { useEffect, useRef, useState } from "react";
import type { SourceClip } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import { msToPct } from "./geometry";
import { Icon } from "../Icon";

type Props = {
  clips: SourceClip[];
  outputDurationMs: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onReorder: (id: string, beforeId: string | null) => void;
};

export function ClipLane({ clips, outputDurationMs, selection, onSelect, onReorder }: Props) {
  const trackRef = useRef<HTMLFieldSetElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const [dropAt, setDropAt] = useState<number | null>(null);
  let offset = 0;
  const regions = clips.map(c => {
    const start = offset;
    offset += c.endMs - c.startMs;
    return { c, start, end: offset };
  });
  return <fieldset ref={trackRef} className="timeline-clip-lane" aria-label="Base video clips" onPointerDown={e => {
    if (e.target === e.currentTarget) onSelect(null);
  }}>
    {regions.map(({ c, start, end }, i) => <button type="button" key={c.id}
      className={`timeline-clip ${selection?.kind === "clip" && selection.id === c.id ? "is-selected" : ""}`}
      data-clip-id={c.id} aria-label={`Video clip ${i + 1}`} aria-pressed={selection?.kind === "clip" && selection.id === c.id}
      title={`Video clip ${i + 1} · ${(c.startMs / 1000).toFixed(1)}–${(c.endMs / 1000).toFixed(1)}s source · Drag to reorder · Select and split at playhead`}
      style={{ left: `${msToPct(start, outputDurationMs)}%`, width: `${msToPct(end - start, outputDurationMs)}%` }}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect({ kind: "clip", id: c.id }); }
        if (e.altKey && e.key === "ArrowLeft" && i > 0) { e.preventDefault(); onReorder(c.id, clips[i - 1]?.id ?? null); }
        if (e.altKey && e.key === "ArrowRight" && i < clips.length - 1) { e.preventDefault(); onReorder(c.id, clips[i + 2]?.id ?? null); }
      }}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect({ kind: "clip", id: c.id });
        cleanupRef.current?.();
        const el = e.currentTarget;
        const pointerId = e.pointerId;
        const box = trackRef.current?.getBoundingClientRect();
        if (!box) return;
        const rest = regions.filter(r => r.c.id !== c.id);
        const pointerStart = e.clientX;
        let beforeId: string | null = null;
        let moved = false;
        el.setPointerCapture(e.pointerId);
        const move = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          if (Math.abs(event.clientX - pointerStart) < 5 && !moved) return;
          moved = true;
          const time = (event.clientX - box.left) / box.width * outputDurationMs;
          const next = rest.find(r => time < (r.start + r.end) / 2);
          beforeId = next?.c.id ?? null;
          setDropAt(next?.start ?? outputDurationMs);
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", finish, true);
          window.removeEventListener("pointercancel", finish, true);
          cleanupRef.current = null;
        };
        const finish = (event: PointerEvent) => {
          if (event.pointerId !== pointerId) return;
          cleanup();
          setDropAt(null);
          if (moved && event.type !== "pointercancel") onReorder(c.id, beforeId);
        };
        cleanupRef.current = cleanup;
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
      }}><Icon name="video" size={15} /><span>Video {i + 1}</span><small>{((end - start) / 1000).toFixed(1)}s</small></button>)}
    {clips.length === 0 && <span className="timeline-empty">All clips removed. Undo to restore.</span>}
    {dropAt !== null && <div className="clip-drop-marker" style={{ left: `${Math.min(99.9, msToPct(dropAt, outputDurationMs))}%` }} />}
  </fieldset>;
}
