import { outputDurationMs, outputToSource } from "../project/timeline";
import type { Cut, SourceClip } from "../project/types";

export type ExportFrame = {
  index: number;
  tOutputMs: number;
  tSourceMs: number;
};

/**
 * Enumerate every frame the export will emit, each already resolved to the
 * source time it must be rendered from.
 *
 * Keeping this pure means the frame-to-source mapping — the part that silently
 * ruins an export when it drifts — is testable without ffmpeg or a GPU.
 */
export function planExportFrames(
  durationMs: number,
  cuts: Cut[],
  fps: number,
  clips?: SourceClip[],
): ExportFrame[] {
  const outMs = outputDurationMs(durationMs, cuts, clips);
  const count = Math.floor((outMs * fps) / 1000);
  const frames: ExportFrame[] = [];

  for (let index = 0; index < count; index++) {
    const tOutputMs = (index * 1000) / fps;
    frames.push({
      index,
      tOutputMs,
      tSourceMs: outputToSource(tOutputMs, durationMs, cuts, clips),
    });
  }

  return frames;
}
