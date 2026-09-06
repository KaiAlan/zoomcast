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
  buttonInput,
  fieldLabel,
  numberInput,
  row,
  sectionHeader,
  selectInput,
  textInput,
} from "./controls";

type Props = {
  style: StyleConfig;
  output: OutputConfig;
  /** Bundle directory, so a chosen image is copied next to the project. */
  dir: string;
  onStyleChange: (next: StyleConfig) => void;
  onOutputChange: (next: OutputConfig) => void;
};

const BACKGROUND_KINDS: BackgroundKind[] = ["gradient", "color", "image", "hidden"];
const BLURS: BlurStrength[] = ["none", "moderate", "strong"];
const FRAME_PRESET_NAMES: FramePreset[] = ["default", "minimal", "hidden"];
/** Kept as strings because SelectRow is generic over string values. */
const EXPORT_FPS_CHOICES = ["30", "60"] as const;

const ASPECTS: AspectChoice[] = ["native", ...(Object.keys(ASPECT_RATIOS) as AspectChoice[])];

/** A number field that accepts anything numeric and lets the model clamp. */
function NumberRow({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={row}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          // Deliberately no range rejection here. Returning without calling the
          // handler leaves the DOM showing text the model never accepted, and
          // the clamp belongs at one place downstream, not at every input.
          const v = Number(e.target.value);
          if (Number.isNaN(v)) return;
          onChange(v);
        }}
        style={numberInput}
      />
    </label>
  );
}

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
export function StylePanel({ style, output, dir, onStyleChange, onOutputChange }: Props) {
  const bg = style.background;
  const frame = style.frame;

  const setBg = (over: Partial<StyleConfig["background"]>): void =>
    onStyleChange({ ...style, background: { ...bg, ...over } });
  const setFrame = (over: Partial<StyleConfig["frame"]>): void =>
    onStyleChange({ ...style, frame: { ...frame, ...over } });

  const chooseImage = (): void => {
    void (async () => {
      const file = await window.zoomcast.chooseBackgroundImage(dir);
      // Null means cancelled, or the copy failed and was logged main-side.
      if (file !== null) setBg({ imageFile: file, kind: "image" });
    })();
  };

  return (
    <div>
      <div style={{ marginTop: 16 }}>
        <div style={sectionHeader}>background</div>

        <SelectRow
          label="kind"
          value={bg.kind}
          options={BACKGROUND_KINDS}
          onChange={(kind) => setBg({ kind })}
        />

        {bg.kind === "gradient" && (
          <SelectRow
            label="preset"
            value={bg.preset}
            options={GRADIENT_PRESETS.map((p) => p.name)}
            onChange={(preset) => setBg({ preset })}
          />
        )}

        {bg.kind === "color" && (
          <label style={row}>
            <span style={fieldLabel}>colour</span>
            <input
              type="text"
              value={bg.color}
              onChange={(e) => setBg({ color: e.target.value })}
              style={textInput}
            />
          </label>
        )}

        {bg.kind === "image" && (
          <>
            <label style={row}>
              <span style={fieldLabel}>image</span>
              <button type="button" onClick={chooseImage} style={buttonInput}>
                choose…
              </button>
            </label>
            <div
              style={{
                ...fieldLabel,
                opacity: 0.5,
                paddingBottom: 6,
                overflowWrap: "anywhere",
              }}
            >
              {bg.imageFile ?? "none chosen"}
            </div>
            <SelectRow
              label="blur"
              value={bg.blur}
              options={BLURS}
              onChange={(blur) => setBg({ blur })}
            />
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={sectionHeader}>frame</div>

        <SelectRow
          label="preset"
          value={frame.preset}
          options={FRAME_PRESET_NAMES}
          onChange={(preset) => setFrame({ preset })}
        />

        {frame.preset === "default" && (
          <>
            <NumberRow
              label="corner radius"
              value={frame.cornerRadiusPx}
              step={2}
              onChange={(cornerRadiusPx) => setFrame({ cornerRadiusPx })}
            />
            <NumberRow
              label="shadow blur"
              value={frame.shadow.blurPx}
              step={4}
              onChange={(blurPx) => setFrame({ shadow: { ...frame.shadow, blurPx } })}
            />
            <NumberRow
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
              <NumberRow
                label="border width"
                value={frame.border.widthPx}
                step={1}
                onChange={(widthPx) => setFrame({ border: { ...frame.border, widthPx } })}
              />
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={sectionHeader}>output</div>

        <SelectRow
          label="aspect"
          value={output.aspect}
          options={ASPECTS}
          onChange={(aspect) => onOutputChange({ ...output, aspect })}
        />

        {output.aspect === "native" && (
          <NumberRow
            label="width"
            value={output.width}
            step={160}
            onChange={(width) => onOutputChange({ ...output, width })}
          />
        )}

        <NumberRow
          label="height"
          value={output.height}
          step={90}
          onChange={(height) => onOutputChange({ ...output, height })}
        />

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
      </div>
    </div>
  );
}
