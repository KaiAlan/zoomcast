import type { ZoomConfig, ZoomKeyframe, ZoomSegment } from "../zoom/types";

export type Cut = { id: string; startMs: number; endMs: number };

export type BackgroundKind = "gradient" | "color" | "image" | "hidden";
export type BlurStrength = "none" | "moderate" | "strong";

/**
 * A flat record, deliberately not a discriminated union.
 *
 * The user toggles `kind` back and forth in the UI, and a union would discard
 * the other kinds' settings on every switch — pick a colour, try a gradient,
 * come back, and the colour is gone. The renderer reads only the field its
 * `kind` selects; the rest are remembered, not applied.
 */
export type Background = {
  kind: BackgroundKind;
  /** Named entry in GRADIENT_PRESETS. Read only when kind is "gradient". */
  preset: string;
  /** Read only when kind is "color". */
  color: string;
  /** Basename of a file copied into the project dir. Read only when kind is "image". */
  imageFile: string | null;
  blur: BlurStrength;
};

export type FramePreset = "default" | "minimal" | "hidden";

export type FrameStyle = {
  preset: FramePreset;
  cornerRadiusPx: number;
  shadow: { blurPx: number; opacity: number; offsetYPx: number };
  border: { visible: boolean; widthPx: number; color: string };
};

export type AspectChoice = "native" | "16:9" | "4:3" | "1:1" | "9:16";

export type CursorStyle = {
  visible: boolean;
  /** 100 = the shape's natural size at 1x zoom. */
  sizePct: number;
  /** 0 = raw telemetry, 1 = heavily damped. */
  smoothing: number;
  shadow: boolean;
  ripples: boolean;
};

export type StyleConfig = {
  paddingFactor: number;
  /**
   * Directional motion blur strength, 0..1. 0 is off, which is the default.
   *
   * A camera property, not a frame one -- FrameStyle is corner radius, shadow
   * and border.
   */
  motionBlurAmount: number;
  frame: FrameStyle;
  background: Background;
  cursor: CursorStyle;
};

export type WebcamConfig = {
  visible: boolean;
  mirror: boolean;
  shape: "circle" | "rounded";
  sizePct: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  marginPx: number;
};

export type OutputConfig = {
  width: number;
  height: number;
  aspect: AspectChoice;
  fps: number;
  bitrateMbps: number;
};

export type Project = {
  version: 1;
  bundleId: string;
  cuts: Cut[];
  zoom: {
    config: ZoomConfig;
    /** The persisted, editable unit; keyframes are derived from these. */
    segments: ZoomSegment[];
    keyframes: ZoomKeyframe[];
  };
  style: StyleConfig;
  webcam: WebcamConfig;
  audio: { micGainDb: number; systemGainDb: number; syncNudgeMs: number };
  output: OutputConfig;
};
