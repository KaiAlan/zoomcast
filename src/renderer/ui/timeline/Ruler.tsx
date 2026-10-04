import { useState } from "react";
import { msToPct } from "./geometry";

type Props = {
  outputDurationMs: number;
  onSeek: (tOutputMs: number) => void;
};

const HEIGHT = 42;

export function rulerStep(outputDurationMs: number): number {
  return [1000, 5000, 10000, 30000, 60000, 300000, 600000].find(value => outputDurationMs / value <= 12) ?? Math.ceil(outputDurationMs / 12 / 600000) * 600000;
}

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
  const step = rulerStep(outputDurationMs);
  for (let t = 0; t <= outputDurationMs; t += step) ticks.push(t);

  return (
    <div
      className="timeline-ruler"
      style={{
        position: "relative",
        height: HEIGHT,
        background: "var(--surface)",
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
      {ticks.map(t => <div key={t} className="timeline-tick" style={{ left: `${msToPct(t, outputDurationMs)}%` }}><span style={t === outputDurationMs ? { transform: "translateX(-100%)", marginLeft: -5 } : undefined}>{`${Math.floor(t / 60000).toString().padStart(2, "0")}:${Math.floor(t / 1000 % 60).toString().padStart(2, "0")}`}</span></div>)}
      {ticks.slice(0, -1).flatMap(t => [1, 2, 3, 4].map(part => <i key={`${t}-${part}`} className="timeline-minor-tick" style={{ left: `${msToPct(t + step * part / 5, outputDurationMs)}%` }} />))}
    </div>
  );
}
