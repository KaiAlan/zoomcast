import { useRef, useState } from "react";
import { COLOR_PRESETS, IMAGE_PRESETS, presetImageUrl, presetProjectFile } from "../../shared/style/imagePresets";
import { SliderField } from "./SliderField";
import { ColorPicker } from "./ColorPicker";
import { InspectorSection } from "./InspectorSection";
import type {
  AspectChoice,
  BackgroundKind,
  BlurStrength,
  FramePreset,
  OutputConfig,
  StyleConfig,
} from "../../shared/project/types";
import { ASPECT_RATIOS } from "../../shared/style/aspect";
import { GRADIENT_PRESETS } from "../../shared/style/backgrounds";
import {
  fieldLabel,
  row,
  selectInput,
} from "./controls";

type Props = {
  group?: "appearance" | "output";
  style: StyleConfig;
  output: OutputConfig;
  /** Bundle directory, so a chosen image is copied next to the project. */
  dir: string;
  onStyleChange: (next: StyleConfig) => void;
  onStyleTransient?: (next: StyleConfig) => void;
  onStyleCommit?: () => void;
  onOutputChange: (next: OutputConfig) => void;
};

const BACKGROUND_KINDS: BackgroundKind[] = ["gradient", "color", "image", "hidden"];
const BLURS: BlurStrength[] = ["none", "moderate", "strong"];
const FRAME_PRESET_NAMES: FramePreset[] = ["default", "minimal", "hidden"];
/** Kept as strings because SelectRow is generic over string values. */
const EXPORT_FPS_CHOICES = ["30", "60"] as const;

const ASPECTS: AspectChoice[] = ["native", ...(Object.keys(ASPECT_RATIOS) as AspectChoice[])];

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label style={row}>
      <span style={fieldLabel}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={selectInput}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={row}>
      <span style={fieldLabel}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * The style controls: background, frame, output.
 *
 * Kind-specific controls are shown only for the kind that reads them. That is
 * not cosmetic — under a non-default frame preset the individual frame fields
 * are ignored by resolveFrame, and an editable control that silently does
 * nothing is a bug report waiting to happen. Blur is image-only for the same
 * reason: on a procedural mesh it is a measured no-op (RMS 0.1 out of 255).
 */
export function StylePanel({ style, output, dir, onStyleChange, onStyleTransient, onStyleCommit, onOutputChange, group }: Props) {
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const latestStyle = useRef(style);
  latestStyle.current = style;
  const bg = style.background;
  const frame = style.frame;

  const setBg = (over: Partial<StyleConfig["background"]>): void =>
    onStyleChange({ ...latestStyle.current, background: { ...latestStyle.current.background, ...over } });
  const setFrame = (over: Partial<StyleConfig["frame"]>): void =>
    onStyleChange({ ...style, frame: { ...frame, ...over } });

  const choosePreset = (id: string): void => {
    setImageBusy(true); setImageError("");
    void window.zoomcast.chooseBackgroundPreset(dir, id).then(file => setBg({ imageFile: file, kind: "image" }))
      .catch((error: unknown) => setImageError(String(error))).finally(() => setImageBusy(false));
  };
  const chooseImage = (): void => {
    setImageBusy(true); setImageError("");
    void window.zoomcast.chooseBackgroundImage(dir).then(file => {
      if (file !== null) setBg({ imageFile: file, kind: "image" });
    }).catch((error: unknown) => setImageError(String(error))).finally(() => setImageBusy(false));
  };

  return (
    <div>
      {group !== "output" && <InspectorSection title="Appearance" hint="Background & frame" defaultOpen>

        <div className="subsection-label first-label">Background</div>
        <fieldset className="segmented-control"><legend className="sr-only">Background type</legend>
          {BACKGROUND_KINDS.map((kind) => <button key={kind} type="button" aria-pressed={bg.kind === kind} onClick={() => setBg({ kind })}>{kind === "hidden" ? "None" : kind.charAt(0).toUpperCase() + kind.slice(1)}</button>)}
        </fieldset>
        {bg.kind === "gradient" && <div className="gradient-grid">
          {GRADIENT_PRESETS.map((preset) => <button key={preset.name} type="button" className={`gradient-swatch ${bg.preset === preset.name ? "selected" : ""}`} title={preset.label} aria-label={`${preset.label} background`} aria-pressed={bg.preset === preset.name} style={{ background: `radial-gradient(ellipse at 15% 15%, ${preset.points[0]?.color}, transparent 70%), radial-gradient(ellipse at 85% 80%, ${preset.points[3]?.color}, transparent 70%), linear-gradient(125deg, ${preset.points[1]?.color}, ${preset.points[2]?.color})` }} onClick={() => setBg({ preset: preset.name })}><span>{preset.label}</span></button>)}
        </div>}
        {bg.kind === "color" && (<>
          <div className="color-preset-grid">{COLOR_PRESETS.map(preset => <button key={preset.name} type="button" className={`color-preset ${bg.color.toLowerCase() === preset.color ? "selected" : ""}`} aria-label={`${preset.name} color background`} aria-pressed={bg.color.toLowerCase() === preset.color} title={preset.name} style={{ background: preset.color }} onClick={() => setBg({ color: preset.color })}><span>{preset.name}</span></button>)}</div>
          <div style={row}>
            <span style={fieldLabel}>Custom color</span>
            <ColorPicker value={bg.color}
              onChange={color => (onStyleTransient ?? onStyleChange)({ ...latestStyle.current, background: { ...latestStyle.current.background, color } })}
              onCommit={() => onStyleCommit?.()} />
          </div></>
        )}

        {bg.kind === "image" && (
          <>
            <button type="button" className="background-upload" disabled={imageBusy} onClick={chooseImage}>Upload custom image</button>
            <div className="image-preset-grid">{IMAGE_PRESETS.map(preset => <button key={preset.id} type="button" title={`${preset.label} · ${preset.author}`} disabled={imageBusy} className={`image-preset ${bg.imageFile === presetProjectFile(preset) ? "selected" : ""}`} aria-label={`${preset.label} image background`} aria-pressed={bg.imageFile === presetProjectFile(preset)} onClick={() => choosePreset(preset.id)}><img src={presetImageUrl(preset)} alt="" decoding="async" /><span>{preset.label}</span></button>)}</div>
            {imageError && <p role="alert" className="control-help">{imageError}</p>}
            <div
              style={{
                ...fieldLabel,
                opacity: 0.5,
                paddingBottom: 6,
                overflowWrap: "anywhere",
              }}
            >
              {IMAGE_PRESETS.find(preset => bg.imageFile === presetProjectFile(preset))?.label ?? bg.imageFile ?? "Choose a preset or your own image"}
            </div>
            <SelectRow
              label="blur"
              value={bg.blur}
              options={BLURS}
              onChange={(blur) => setBg({ blur })}
            />
          </>
        )}
        <div className="subsection-label">Frame</div>

        <SelectRow
          label="preset"
          value={frame.preset}
          options={FRAME_PRESET_NAMES}
          onChange={(preset) => setFrame({ preset })}
        />

        <SliderField label="Motion blur" value={style.motionBlurAmount} min={0} max={1} step={0.05} onChange={(motionBlurAmount) => onStyleChange({ ...style, motionBlurAmount })} />
        <SliderField label="Padding" value={Math.round((1 - style.paddingFactor) * 100)} min={0} max={45} unit="%" onChange={(padding) => onStyleChange({ ...style, paddingFactor: 1 - padding / 100 })} />
        {frame.preset === "default" && (
          <>
            <SliderField max={100} unit="px"
              label="corner radius"
              value={frame.cornerRadiusPx}
              step={2}
              onChange={(cornerRadiusPx) => setFrame({ cornerRadiusPx })}
            />
            <SliderField max={160} unit="px"
              label="shadow blur"
              value={frame.shadow.blurPx}
              step={4}
              onChange={(blurPx) => setFrame({ shadow: { ...frame.shadow, blurPx } })}
            />
            <SliderField max={1}
              label="shadow opacity"
              value={frame.shadow.opacity}
              step={0.05}
              onChange={(opacity) => setFrame({ shadow: { ...frame.shadow, opacity } })}
            />
            <CheckRow
              label="border"
              checked={frame.border.visible}
              onChange={(visible) => setFrame({ border: { ...frame.border, visible } })}
            />
            {frame.border.visible && (
              <SliderField max={20} unit="px"
                label="border width"
                value={frame.border.widthPx}
                step={1}
                onChange={(widthPx) => setFrame({ border: { ...frame.border, widthPx } })}
              />
            )}
          </>
        )}
      </InspectorSection>}
      {group !== "appearance" && <InspectorSection title="Output" hint="Size & frame rate">

        <SelectRow
          label="aspect"
          value={output.aspect}
          options={ASPECTS}
          onChange={(aspect) => onOutputChange({ ...output, aspect })}
        />

        {output.aspect === "native" && (
          <SliderField label="Width" unit="px" min={320} max={Math.max(7680, output.width)} step={10} value={output.width} onChange={width => onOutputChange({ ...output, width })} />
        )}

        <SliderField label="Height" unit="px" min={240} max={Math.max(4320, output.height)} step={10} value={output.height} onChange={height => onOutputChange({ ...output, height })} />

        {/*
          A choice, not a NumberRow. The field stepped by 30 from a default of
          60, so 0 was two clicks away — and planExportFrames at 0 emits no
          frames while ffmpeg gets `-r 0`.
        */}
        <SelectRow
          label="fps"
          value={String(output.fps)}
          options={EXPORT_FPS_CHOICES}
          onChange={(fps) => onOutputChange({ ...output, fps: Number(fps) })}
        />
      </InspectorSection>}
    </div>
  );
}
