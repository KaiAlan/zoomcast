import { DEFAULT_ZOOM_CONFIG } from "../zoom/config";
import type { Project } from "./types";

export function defaultProject(bundleId: string): Project {
  return {
    version: 1,
    bundleId,
    cuts: [],
    zoom: { config: { ...DEFAULT_ZOOM_CONFIG }, keyframes: [] },
    style: {
      paddingFactor: 0.85,
      cornerRadiusPx: 12,
      shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
      background: { kind: "gradient", from: "#1b1d23", to: "#0d0e11", angle: 135 },
      cursor: {
        visible: true,
        sizePct: 100,
        smoothing: 0.8,
        shadow: true,
        ripples: true,
      },
    },
    webcam: {
      visible: true,
      shape: "circle",
      sizePct: 18,
      position: "bottom-right",
      marginPx: 32,
    },
    audio: { micGainDb: 0, systemGainDb: -6, syncNudgeMs: 0 },
    output: { width: 1920, height: 1080, fps: 60, bitrateMbps: 12 },
  };
}
