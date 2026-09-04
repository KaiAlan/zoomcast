import type { ZoomConfig, ZoomKeyframe } from "../zoom/types";

export type Cut = { startMs: number; endMs: number };

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number };

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
  cornerRadiusPx: number;
  shadow: { blurPx: number; opacity: number; offsetYPx: number };
  background: Background;
  cursor: CursorStyle;
};

export type WebcamConfig = {
  visible: boolean;
  shape: "circle" | "rounded";
  sizePct: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  marginPx: number;
};

export type OutputConfig = {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
};

export type Project = {
  version: 1;
  bundleId: string;
  cuts: Cut[];
  zoom: { config: ZoomConfig; keyframes: ZoomKeyframe[] };
  style: StyleConfig;
  webcam: WebcamConfig;
  audio: { micGainDb: number; systemGainDb: number; syncNudgeMs: number };
  output: OutputConfig;
};
