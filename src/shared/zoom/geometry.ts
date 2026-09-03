import type { Cluster, PlanContext, Size, ZoomConfig } from "./types";

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
 * The zoom level at which one source pixel maps to one output pixel.
 * Above this the export is upscaling and softens.
 *
 * Deriving this rather than hardcoding it means a higher-resolution source
 * lifts the ceiling with no code change: on a 1080p panel it lands near
 * 1.18x, and recording a 4K virtual display makes the same call return 2.35x.
 */
export function maxComfortableZoom(
  source: Size,
  output: Size,
  paddingFactor: number,
): number {
  return source.w / screenRect(source, output, paddingFactor).w;
}

/** Zoom needed to fit a cluster's bounds, clamped to what stays sharp. */
export function fitScale(c: Cluster, cfg: ZoomConfig, ctx: PlanContext): number {
  const boundsW = c.maxX - c.minX + cfg.marginPx * 2;
  const boundsH = c.maxY - c.minY + cfg.marginPx * 2;

  const desired = Math.min(
    ctx.source.w / Math.max(boundsW, 1),
    ctx.source.h / Math.max(boundsH, 1),
  );

  return clamp(
    desired,
    1,
    maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor),
  );
}
