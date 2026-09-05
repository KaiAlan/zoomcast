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
      frame: {
        preset: "default",
        cornerRadiusPx: 12,
        shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
        border: { visible: false, widthPx: 1, color: "#ffffff22" },
      },
      background: {
        kind: "gradient",
        preset: "aurora",
        color: "#0d0e11",
        imageFile: null,
        blur: "none",
      },
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
    output: { width: 1920, height: 1080, aspect: "native", fps: 60, bitrateMbps: 12 },
  };
}
