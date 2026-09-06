import type { FramePreset, FrameStyle } from "../project/types";

type FrameValues = Omit<FrameStyle, "preset">;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The three frame looks.
 *
 * "default" is the EDITABLE preset, and its entry here is the starting point
 * rather than an override: resolveFrame reads the project's own fields under
 * it. That is what lets a user tune a radius, tour minimal and hidden, and come
 * back to their own value instead of a reset one.
 */
export const FRAME_PRESETS: Record<FramePreset, FrameValues> = {
  default: {
    cornerRadiusPx: 12,
    shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
    border: { visible: false, widthPx: 1, color: "#ffffff22" },
  },
  minimal: {
    cornerRadiusPx: 6,
    shadow: { blurPx: 20, opacity: 0.18, offsetYPx: 6 },
    border: { visible: true, widthPx: 1, color: "#ffffff1a" },
  },
  hidden: {
    cornerRadiusPx: 0,
    shadow: { blurPx: 0, opacity: 0, offsetYPx: 0 },
    border: { visible: false, widthPx: 0, color: "#00000000" },
  },
};

/**
 * The frame values actually rendered, given the style.
 *
 * Every renderer read must go through this rather than touching
 * `style.frame.*` directly, or the presets silently do nothing. Clamping lives
 * here too, so there is one place that decides what a legal frame is —
 * `offsetYPx` is deliberately not clamped, because a negative offset lifting
 * the shadow is a legitimate look.
 */
export function resolveFrame(frame: FrameStyle): FrameValues {
  const v: FrameValues =
    frame.preset === "default"
      ? {
          cornerRadiusPx: frame.cornerRadiusPx,
          shadow: frame.shadow,
          border: frame.border,
        }
      : FRAME_PRESETS[frame.preset];

  return {
    cornerRadiusPx: Math.max(0, v.cornerRadiusPx),
    shadow: {
      blurPx: Math.max(0, v.shadow.blurPx),
      opacity: clamp(v.shadow.opacity, 0, 1),
      offsetYPx: v.shadow.offsetYPx,
    },
    border: {
      visible: v.border.visible,
      widthPx: Math.max(0, v.border.widthPx),
      color: v.border.color,
    },
  };
}
