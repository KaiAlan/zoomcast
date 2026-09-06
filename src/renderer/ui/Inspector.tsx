import type {
  CursorStyle,
  OutputConfig,
  StyleConfig,
} from "../../shared/project/types";
import type { ZoomConfig } from "../../shared/zoom/types";
import { fieldLabel, numberInput, row, sectionHeader } from "./controls";
import { StylePanel } from "./StylePanel";

type Props = {
  config: ZoomConfig;
  onChange: (next: ZoomConfig) => void;
  cursor: CursorStyle;
  onCursorChange: (next: CursorStyle) => void;
  style: StyleConfig;
  output: OutputConfig;
  dir: string;
  onStyleChange: (next: StyleConfig) => void;
  onOutputChange: (next: OutputConfig) => void;
};

/** The knobs worth reaching for while tuning; the rest live in project.json. */
const FIELDS: Array<{ key: keyof ZoomConfig; label: string; step: number }> = [
  { key: "minHoldMs", label: "min hold (ms)", step: 100 },
  { key: "minDwellMs", label: "min dwell (ms)", step: 100 },
  { key: "minRecoveryMs", label: "min recovery (ms)", step: 50 },
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

export function Inspector({
  config,
  onChange,
  cursor,
  onCursorChange,
  style,
  output,
  dir,
  onStyleChange,
  onOutputChange,
}: Props) {
  return (
    <div>
      <div style={sectionHeader}>zoom planner</div>

      {FIELDS.map(({ key, label, step }) => (
        <label key={key} style={row}>
          <span style={fieldLabel}>{label}</span>
          <input
            type="number"
            step={step}
            value={config[key] as number}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              onChange({ ...config, [key]: value });
            }}
            style={numberInput}
          />
        </label>
      ))}

      <div style={{ marginTop: 16 }}>
        <div style={sectionHeader}>cursor</div>

        <label style={row}>
          <span style={fieldLabel}>visible</span>
          <input
            type="checkbox"
            checked={cursor.visible}
            onChange={(e) => onCursorChange({ ...cursor, visible: e.target.checked })}
          />
        </label>

        <label style={row}>
          <span style={fieldLabel}>size (%)</span>
          <input
            type="number"
            step={10}
            min={10}
            value={cursor.sizePct}
            onChange={(e) => {
              // Accept anything numeric and let CursorTextureCache clamp.
              //
              // Rejecting here returned without calling the handler, so no
              // state changed, so React never re-rendered and the input kept
              // the rejected text until some unrelated render snapped it back.
              // One clamp site instead: out-of-range renders as a min- or
              // max-size cursor, which explains itself and recovers as soon as
              // the user finishes typing. min={10} stays as spinner behaviour.
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              onCursorChange({ ...cursor, sizePct: value });
            }}
            style={numberInput}
          />
        </label>

        <label style={row}>
          <span style={fieldLabel}>smoothing</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cursor.smoothing}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              onCursorChange({ ...cursor, smoothing: Math.min(1, Math.max(0, value)) });
            }}
          />
        </label>

        <label style={row}>
          <span style={fieldLabel}>shadow</span>
          <input
            type="checkbox"
            checked={cursor.shadow}
            onChange={(e) => onCursorChange({ ...cursor, shadow: e.target.checked })}
          />
        </label>

        <label style={row}>
          <span style={fieldLabel}>ripples</span>
          <input
            type="checkbox"
            checked={cursor.ripples}
            onChange={(e) => onCursorChange({ ...cursor, ripples: e.target.checked })}
          />
        </label>
      </div>

      <StylePanel
        style={style}
        output={output}
        dir={dir}
        onStyleChange={onStyleChange}
        onOutputChange={onOutputChange}
      />
    </div>
  );
}
