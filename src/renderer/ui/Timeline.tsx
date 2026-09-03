import { useState } from "react";
import { sourceToOutput } from "../../shared/project/timeline";
import type { Cut } from "../../shared/project/types";
import type { ZoomKeyframe } from "../../shared/zoom/types";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  keyframes: ZoomKeyframe[];
  playheadMs: number;
  maxComfortableZoom: number;
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
  playheadMs,
  maxComfortableZoom,
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

        {keyframes.map((k) => {
          const out = sourceToOutput(k.tSourceMs, durationMs, cuts);
          if (out === null) return null;

          const zoomed = k.scale > 1;
          const overSharp = k.scale > maxComfortableZoom + 0.001;

          return (
            <div
              key={k.id}
              title={`${k.id} · scale ${k.scale.toFixed(3)}${overSharp ? " · past 1:1" : ""}${k.pinned ? " · pinned" : ""}`}
              style={{
                position: "absolute",
                left: `${pct(out)}%`,
                top: zoomed ? 10 : 44,
                width: 3,
                height: 24,
                marginLeft: -1,
                borderRadius: 2,
                background: overSharp ? "#e0894a" : zoomed ? "#6aa6e8" : "#4a5568",
                outline: k.pinned ? "1px solid #f0f0f0" : "none",
              }}
            />
          );
        })}

        <div
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
          {keyframes.filter((k) => k.scale > 1).length} zooms · {cuts.length} cuts ·
          ceiling {maxComfortableZoom.toFixed(2)}×
        </span>
        <span>{fmt(outputDurationMs)}</span>
      </div>
    </div>
  );
}
