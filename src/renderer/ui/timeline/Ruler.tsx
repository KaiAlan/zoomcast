import { useState } from "react";
import { msToPct } from "./geometry";

type Props = {
  outputDurationMs: number;
  onSeek: (tOutputMs: number) => void;
};

const HEIGHT = 24;

/** Owns scrubbing for the whole timeline; the lanes below it do not. */
export function Ruler({ outputDurationMs, onSeek }: Props) {
  const [scrubbing, setScrubbing] = useState(false);

  /** Map a pointer position on the ruler to an output time. */
  const seekTo = (clientX: number, el: HTMLElement): void => {
    const box = el.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;
    onSeek(Math.max(0, Math.min(1, ratio)) * outputDurationMs);
  };

  const ticks: number[] = [];
  const step = outputDurationMs > 20_000 ? 5000 : 1000;
  for (let t = 0; t <= outputDurationMs; t += step) ticks.push(t);

  return (
    <div
      style={{
        position: "relative",
        height: HEIGHT,
        background: "#15171c",
        border: "1px solid #23262e",
        borderBottom: "none",
        borderRadius: "6px 6px 0 0",
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
            left: `${msToPct(t, outputDurationMs)}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: "#23262e",
          }}
        />
      ))}
    </div>
  );
}
