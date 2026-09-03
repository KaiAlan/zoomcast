import type { ZoomConfig } from "../../shared/zoom/types";

type Props = {
  config: ZoomConfig;
  onChange: (next: ZoomConfig) => void;
};

/** The knobs worth reaching for while tuning; the rest live in project.json. */
const FIELDS: Array<{ key: keyof ZoomConfig; label: string; step: number }> = [
  { key: "minHoldMs", label: "min hold (ms)", step: 100 },
  { key: "deadzonePx", label: "deadzone (px)", step: 10 },
  { key: "maxZoomsPerMinute", label: "max zooms / min", step: 1 },
  { key: "clusterRadiusPx", label: "cluster radius (px)", step: 10 },
  { key: "clusterWindowMs", label: "cluster window (ms)", step: 100 },
  { key: "minGapMs", label: "min gap (ms)", step: 50 },
  { key: "minWeight", label: "min weight", step: 0.1 },
  { key: "marginPx", label: "margin (px)", step: 10 },
  { key: "leadInMs", label: "lead in (ms)", step: 50 },
  { key: "trailMs", label: "trail (ms)", step: 50 },
  { key: "transitionMs", label: "transition (ms)", step: 50 },
];

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "5px 0",
};

export function Inspector({ config, onChange }: Props) {
  return (
    <div>
      <div style={{ fontSize: 13, opacity: 0.55, marginBottom: 8 }}>zoom planner</div>

      {FIELDS.map(({ key, label, step }) => (
        <label key={key} style={row}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>{label}</span>
          <input
            type="number"
            step={step}
            value={config[key] as number}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              onChange({ ...config, [key]: value });
            }}
            style={{
              width: 92,
              background: "#0f1115",
              color: "#e6e6e6",
              border: "1px solid #2a2e38",
              borderRadius: 4,
              padding: "4px 6px",
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>
      ))}
    </div>
  );
}
