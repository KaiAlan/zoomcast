import { clamp } from "./geometry";
import type { ImpulseKind, ZoomConfig } from "./types";

export type Intent = "click" | "type" | "scroll";

export type DepthInputs = {
  /** Dominant kind of activity in the cluster, by weight. */
  intent: Intent;
  /**
   * The cluster's bounding box as a FRACTION of the source, per axis — not in
   * pixels, so the rule is resolution-independent and a 4K capture grades the
   * same way a 1080p one does.
   */
  spread: { x: number; y: number };
  /**
   * NOT AVAILABLE TODAY, and deliberately so. The telemetry is raw screen
   * coordinates with no element behind them; getting real bounds needs either
   * UI Automation over COM or computer vision on the captured frame, and both
   * are their own project. See the 2026-09-07 spec §8.
   *
   * Absent means "no constraint" — never "size zero".
   */
  targetSize?: { x: number; y: number };
};

export type DepthConfig = {
  base: Record<Intent, number>;
  /** What fraction of the frame the activity may occupy. */
  contextFraction: number;
  maxZoom: number;
  intentWeight: Record<ImpulseKind, number>;
};

export const DEFAULT_DEPTH_CONFIG: DepthConfig = {
  base: { click: 1.55, type: 1.35, scroll: 1.15 },
  contextFraction: 0.8,
  maxZoom: 1.6,
  intentWeight: { click: 1, key: 0.4, wheel: 0.3 },
};

/**
 * How deep a zoom goes, as an absolute scale.
 *
 * Intent sets the base and spread only ever pulls it back. That asymmetry is
 * measured, not stylistic: of the 54 clusters that earn a zoom across every
 * take on disk, 29 have zero spatial spread and 38 are under 200px, so there
 * is nothing to grade on for most zooms. Spread is a safety valve that stops a
 * wide scatter of activity being framed too tightly; it fires on about 8 of
 * those 54.
 *
 * Pure: no renderer, no layout, no clock (invariant 9).
 */
export function zoomDepth(inputs: DepthInputs, cfg: DepthConfig): number {
  const base = cfg.base[inputs.intent];
  const spreadMax = Math.max(inputs.spread.x, inputs.spread.y);

  // A zero-spread cluster has no spread constraint. Written out rather than
  // left to division by zero: `0.6 / 0` is Infinity and therefore happens to
  // give the right answer, and a correct result reached by accident is one
  // refactor away from a NaN.
  const pullback =
    spreadMax > 0 ? cfg.contextFraction / spreadMax : Number.POSITIVE_INFINITY;

  return clamp(Math.min(base, pullback), 1, cfg.maxZoom);
}

/**
 * The depth rule's config, from the persisted one.
 *
 * `ZoomConfig` stays flat because `normalizeProject` spreads it over the
 * defaults — a nested object stored partially would replace the whole default
 * rather than merge into it, and old projects would silently lose fields. This
 * adapter is what lets the pure function take the shape the spec describes
 * while persistence keeps the shape migration can handle.
 */
export function depthConfigFrom(cfg: ZoomConfig): DepthConfig {
  return {
    base: { click: cfg.zoomClick, type: cfg.zoomType, scroll: cfg.zoomScroll },
    contextFraction: cfg.contextFraction,
    maxZoom: cfg.maxZoom,
    intentWeight: {
      click: cfg.intentWeightClick,
      key: cfg.intentWeightKey,
      wheel: cfg.intentWeightWheel,
    },
  };
}
