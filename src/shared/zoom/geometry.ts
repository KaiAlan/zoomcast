import type { Size } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The screen quad at zoom 1: source aspect, inset by paddingFactor, centred. */
export function screenRect(source: Size, output: Size, paddingFactor: number): Rect {
  const maxW = output.w * paddingFactor;
  const maxH = output.h * paddingFactor;
  const aspect = source.w / source.h;

  let w = maxW;
  let h = w / aspect;

  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }

  return { x: (output.w - w) / 2, y: (output.h - h) / 2, w, h };
}

/**
 * The zoom at which one source pixel maps to one frame pixel. Above it the
 * picture is upscaled and softens.
 *
 * ADVICE, NOT A CAP, since 2026-09-07. It used to be the hard ceiling, which
 * made the entire zoom range 1/paddingFactor — the factor at which the old
 * growing frame exactly filled the output — so every zoom landed on it and the
 * camera had nowhere to go. The cap is now `ZoomConfig.maxZoom`; this number is
 * what the UI reports so the softening threshold stays visible.
 *
 * Deriving it rather than hardcoding it means a higher-resolution source lifts
 * it with no code change: on a 1080p panel it lands near 1.18x, and recording a
 * 4K virtual display makes the same call return 2.35x.
 */
export function pixelParityZoom(
  source: Size,
  output: Size,
  paddingFactor: number,
): number {
  return source.w / screenRect(source, output, paddingFactor).w;
}
