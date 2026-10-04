import type { WebcamConfig } from "../project/types";
import type { Size } from "../zoom/types";
import type { SourceRect } from "../zoom/viewport";
import { toStreamLocalMs } from "../bundle/streamTime";

/** Output-space geometry: screen zoom never moves or enlarges PiP. */
export function webcamLayout(output: Size, source: Size, config: WebcamConfig) {
  const short = Math.min(output.w, output.h);
  const margin = Math.max(0, Math.min(short / 4, config.marginPx));
  const h = Math.max(1, Math.min(short * Math.max(5, Math.min(50, config.sizePct)) / 100, short - margin * 2));
  const w = Math.min(output.w - margin * 2, config.shape === "circle" ? h : h * source.w / source.h);
  const height = config.shape === "circle" ? w : Math.min(h, w * source.h / source.w);
  const quad = {
    x: config.position.endsWith("right") ? output.w - margin - w : margin,
    y: config.position.startsWith("bottom") ? output.h - margin - height : margin,
    w, h: height,
  };
  const scale = Math.max(w / source.w, height / source.h);
  const region: SourceRect = {
    x: (1 - w / (source.w * scale)) / 2,
    y: (1 - height / (source.h * scale)) / 2,
    w: w / (source.w * scale),
    h: height / (source.h * scale),
  };
  if (config.mirror) { region.x += region.w; region.w = -region.w; }
  return { quad, region, radiusPx: config.shape === "circle" ? w / 2 : Math.min(w, height) * 0.12 };
}

/** No camera before its first frame or after its last; offsets are signed. */
export function webcamTime(tSourceMs: number, startOffsetMs: number, durationMs: number): number | null {
  const local = toStreamLocalMs(tSourceMs, startOffsetMs);
  return local >= 0 && local < durationMs ? local : null;
}
