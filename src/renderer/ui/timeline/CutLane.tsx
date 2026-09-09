import { sourceSpanToOutput } from "../../../shared/project/timeline";
import type { Cut } from "../../../shared/project/types";
import type { Selection } from "../../../shared/project/history";
import { msToPct } from "./geometry";

type Props = {
  durationMs: number;
  outputDurationMs: number;
  cuts: Cut[];
  selection: Selection;
  onSelect: (s: Selection) => void;
};

const HEIGHT = 20;

export function CutLane({ durationMs, outputDurationMs, cuts, selection, onSelect }: Props) {
  return (
    <div
      style={{
        position: "relative",
        height: HEIGHT,
        background: "#15171c",
        border: "1px solid #23262e",
        borderTop: "none",
        borderRadius: "0 0 6px 6px",
        overflow: "hidden",
      }}
    >
      {cuts.map((c) => {
        // A cut is fully rippled out of `outputDurationMs`, so mapping its own
        // span through the full `cuts` list swallows it whole (that is what
        // `sourceSpanToOutput` does with a span a cut entirely covers). What
        // the lane needs instead is where that removed span sits net of every
        // *other* cut's ripple — the gap this cut left behind.
        const others = cuts.filter((x) => x.id !== c.id);
        const span = sourceSpanToOutput(c.startMs, c.endMs, durationMs, others);
        if (span === null) return null;

        const selected = selection?.kind === "cut" && selection.id === c.id;

        return (
          <div
            key={c.id}
            title={c.id}
            onPointerDown={() => {
              onSelect(selected ? null : { kind: "cut", id: c.id });
            }}
            style={{
              position: "absolute",
              left: `${msToPct(span.startMs, outputDurationMs)}%`,
              width: `${Math.max(0, msToPct(span.endMs, outputDurationMs) - msToPct(span.startMs, outputDurationMs))}%`,
              top: 2,
              bottom: 2,
              borderRadius: 3,
              boxSizing: "border-box",
              background:
                "repeating-linear-gradient(45deg, rgba(232,140,110,0.28) 0, rgba(232,140,110,0.28) 3px, transparent 3px, transparent 7px)",
              border: `1px solid ${selected ? "#e8ecf2" : "rgba(232,140,110,0.5)"}`,
              cursor: "pointer",
            }}
          />
        );
      })}
    </div>
  );
}
