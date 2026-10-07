import { CursorPanel } from "./CursorPanel";
import { SliderField } from "./SliderField";
import { InspectorSection, InspectorTab } from "./InspectorSection";
import type {
  Project,
  WebcamConfig,
  CursorStyle,
  OutputConfig,
  StyleConfig,
} from "../../shared/project/types";
import { DEFAULT_ZOOM_CONFIG } from "../../shared/zoom/config";
import { CURVES } from "../../shared/zoom/curves";
import type { EasingName, ZoomConfig } from "../../shared/zoom/types";
import { buttonInput, fieldLabel, row, sectionHeader, selectInput } from "./controls";
import { StylePanel } from "./StylePanel";

type Props = {
  activeSection: string;
  audio: Project["audio"];
  onAudioChange: (next: Project["audio"]) => void;
  webcam: WebcamConfig;
  hasWebcam: boolean;
  onWebcamChange: (next: WebcamConfig) => void;
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
  { key: "transitionMs", label: "transition in (ms)", step: 50, min: 100 },
  // A good exit is quicker than the entrance: the reference is 1523 in, 1015 out.
  { key: "transitionOutMs", label: "transition out (ms)", step: 50, min: 100 },
  // Travelling between focus points inside one shot. Its curve is fixed
  // (`cameraPan`) — it is a mechanism, not a look, like `linear` for follow.
  { key: "panMs", label: "pan (ms)", step: 50, min: 100 },
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

const ZOOM_LIMITS: Partial<Record<keyof ZoomConfig, number>> = { minHoldMs: 10000, minDwellMs: 10000, minRecoveryMs: 10000, deadzonePx: 500, maxZoomsPerMinute: 60, clusterRadiusPx: 1000, clusterWindowMs: 10000, minGapMs: 5000, minWeight: 10, leadInMs: 3000, trailMs: 5000, transitionMs: 5000, transitionOutMs: 5000, panMs: 5000, maxZoom: 5, depthClick: 1, depthType: 1, depthScroll: 1, contextFraction: 1 };
const ZOOM_GROUPS = [
  { title: "Pacing", keys: ["minHoldMs", "minDwellMs", "minRecoveryMs", "maxZoomsPerMinute", "minGapMs"] },
  { title: "Camera motion", keys: ["transitionMs", "transitionOutMs", "panMs", "leadInMs", "trailMs"] },
  { title: "Zoom depth", keys: ["maxZoom", "depthClick", "depthType", "depthScroll", "contextFraction"] },
  { title: "Activity detection", keys: ["deadzonePx", "clusterRadiusPx", "clusterWindowMs", "minWeight"] },
];

export function Inspector({
  activeSection,
  webcam, hasWebcam, onWebcamChange, audio, onAudioChange,
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
    <InspectorTab.Provider value={activeSection}>
      <StylePanel group="appearance" style={style} output={output} dir={dir} onStyleChange={onStyleChange} onOutputChange={onOutputChange} />
      <InspectorSection title="Webcam" hint={hasWebcam ? "PiP" : "Not recorded"}>
      {!hasWebcam ? <p style={{ fontSize: 12 }}>Enable webcam in Settings before recording.</p> : <>
        <label style={row}><span style={fieldLabel}>visible</span><input type="checkbox" checked={webcam.visible} onChange={(e) => onWebcamChange({ ...webcam, visible: e.target.checked })} /></label>
        <label style={row}><span style={fieldLabel}>mirror</span><input type="checkbox" checked={webcam.mirror} onChange={(e) => onWebcamChange({ ...webcam, mirror: e.target.checked })} /></label>
        <label style={row}><span style={fieldLabel}>shape</span><select style={selectInput} value={webcam.shape} onChange={(e) => onWebcamChange({ ...webcam, shape: e.target.value as WebcamConfig["shape"] })}><option value="circle">Circle</option><option value="rounded">Rounded rectangle</option></select></label>
        <div className="subsection-label">Position</div>
        <fieldset className="position-grid"><legend className="sr-only">Webcam position</legend>{(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((position, i) => <button key={position} type="button" aria-label={position.replace("-", " ")} aria-pressed={webcam.position === position} onClick={() => onWebcamChange({ ...webcam, position })}>{["↖", "↗", "↙", "↘"][i]}</button>)}</fieldset>
        <SliderField label="Webcam size" min={5} max={50} unit="%" value={webcam.sizePct} onChange={(sizePct) => onWebcamChange({ ...webcam, sizePct })} />
        <SliderField label="Margin" max={160} unit="px" value={webcam.marginPx} onChange={(marginPx) => onWebcamChange({ ...webcam, marginPx })} />
      </>}
      </InspectorSection>
      <CursorPanel cursor={cursor} onChange={onCursorChange} />
      <InspectorSection title="Audio" hint="Mix & sync">
        <SliderField label="Microphone" unit="dB" min={-60} max={24} value={audio.micGainDb} onChange={micGainDb => onAudioChange({ ...audio, micGainDb })} />
        <SliderField label="System audio" unit="dB" min={-60} max={24} value={audio.systemGainDb} onChange={systemGainDb => onAudioChange({ ...audio, systemGainDb })} />
        <SliderField label="Sync offset" unit="ms" min={-2000} max={2000} step={10} value={audio.syncNudgeMs} onChange={syncNudgeMs => onAudioChange({ ...audio, syncNudgeMs })} />
        <p className="control-help">Audio gains and sync apply to the exported video.</p>
      </InspectorSection>
      <StylePanel group="output" style={style} output={output} dir={dir} onStyleChange={onStyleChange} onOutputChange={onOutputChange} />
      <InspectorSection title="Advanced zoom" hint="Planner">
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

      {ZOOM_GROUPS.map(group => <div className="zoom-control-group" key={group.title}>
        <div className="subsection-label">{group.title}</div>
        {FIELDS.filter(field => group.keys.includes(field.key)).map(({ key, label, step, min }) => <SliderField key={key} label={label.replace(/ \(ms\)| \(px\)| \(×\)/g, "")} unit={key.endsWith("Ms") ? "ms" : key.endsWith("Px") ? "px" : key === "maxZoom" ? "×" : ""} min={min} max={Math.max(ZOOM_LIMITS[key] ?? 1, config[key] as number)} step={step} value={config[key] as number} onChange={value => onChange({ ...config, [key]: value })} />)}
      </div>)}

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

      </InspectorSection>
    </InspectorTab.Provider>
  );
}
