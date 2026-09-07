import type {
  CursorStyle,
  OutputConfig,
  StyleConfig,
} from "../../shared/project/types";
import { DEFAULT_ZOOM_CONFIG } from "../../shared/zoom/config";
import type { EasingName, ZoomConfig } from "../../shared/zoom/types";
import { buttonInput, fieldLabel, numberInput, row, sectionHeader, selectInput } from "./controls";
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

/**
 * The knobs worth reaching for while tuning; the rest live in project.json.
 *
 * Every one carries a floor, because these are number inputs and a typo is
 * silent. A negative `clusterWindowMs` makes `impulse.t - cluster.endT <= win`
 * unsatisfiable — time only moves forward — so clustering switches off
 * entirely and every click becomes its own zoom. That happened, and from the
 * panel it looks like any other value.
 */
const FIELDS: Array<{ key: keyof ZoomConfig; label: string; step: number; min: number }> = [
  { key: "minHoldMs", label: "min hold (ms)", step: 100, min: 0 },
  { key: "minDwellMs", label: "min dwell (ms)", step: 100, min: 0 },
  { key: "minRecoveryMs", label: "min recovery (ms)", step: 50, min: 0 },
  { key: "deadzonePx", label: "deadzone (px)", step: 10, min: 0 },
  // One zoom a minute at least, or the budget deletes every cluster.
  { key: "maxZoomsPerMinute", label: "max zooms / min", step: 1, min: 1 },
  { key: "clusterRadiusPx", label: "cluster radius (px)", step: 10, min: 1 },
  { key: "clusterWindowMs", label: "cluster window (ms)", step: 100, min: 0 },
  { key: "minGapMs", label: "min gap (ms)", step: 50, min: 0 },
  { key: "minWeight", label: "min weight", step: 0.1, min: 0 },
  { key: "leadInMs", label: "lead in (ms)", step: 50, min: 0 },
  { key: "trailMs", label: "trail (ms)", step: 50, min: 0 },
  // Below ~100ms a "transition" is a cut, and the dwell floor is twice this.
  { key: "transitionMs", label: "transition (ms)", step: 50, min: 100 },
  // Above pixelParityZoom (~1.18 here) the picture is upscaled; the frame's
  // inset means 1.6 costs 1.36x, not 1.6x. Below 1 there is no zoom at all.
  { key: "maxZoom", label: "max zoom (×)", step: 0.05, min: 1 },
  // The depth grading, as fractions of max zoom. Exposed because they are the
  // dials that decide how deep a shot goes; without them "max zoom" looks like
  // the only depth control and the grading is invisible.
  { key: "depthClick", label: "depth · click", step: 0.05, min: 0 },
  { key: "depthType", label: "depth · typing", step: 0.05, min: 0 },
  { key: "depthScroll", label: "depth · scroll", step: 0.05, min: 0 },
  { key: "contextFraction", label: "context fraction", step: 0.05, min: 0.1 },
];

/**
 * The curves worth offering. `linear` is deliberately absent: it is what the
 * follow camera's own samples use so the precomputed path is what renders, not
 * a look anyone would choose for a zoom.
 */
const CURVES: Array<{ value: EasingName; label: string }> = [
  { value: "zoomGlide", label: "glide — even, peaks mid-move" },
  { value: "zoomEase", label: "ease — fast in, drifting tail" },
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
  const isTuned = FIELDS.every((f) => config[f.key] === DEFAULT_ZOOM_CONFIG[f.key]) &&
    config.easing === DEFAULT_ZOOM_CONFIG.easing;

  return (
    <div>
      <div
        style={{
          ...sectionHeader,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>zoom planner</span>
        <button
          type="button"
          style={{ ...buttonInput, padding: "2px 8px", fontSize: 11 }}
          disabled={isTuned}
          title={
            isTuned
              ? "already at the tuned defaults"
              : "restore the defaults tuned against real footage"
          }
          onClick={() => onChange({ ...DEFAULT_ZOOM_CONFIG })}
        >
          {isTuned ? "tuned" : "reset"}
        </button>
      </div>

      {FIELDS.map(({ key, label, step, min }) => (
        <label key={key} style={row}>
          <span style={fieldLabel}>{label}</span>
          <input
            type="number"
            step={step}
            min={min}
            value={config[key] as number}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value)) return;
              // Clamped on the way in, not just declared on the input: the
              // min attribute makes the field look invalid but still fires
              // onChange with the bad value.
              onChange({ ...config, [key]: Math.max(min, value) });
            }}
            style={numberInput}
          />
        </label>
      ))}

      <label style={row}>
        <span style={fieldLabel}>transition curve</span>
        <select
          value={config.easing === "linear" ? "zoomGlide" : config.easing}
          onChange={(e) => onChange({ ...config, easing: e.target.value as EasingName })}
          style={selectInput}
        >
          {CURVES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

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
