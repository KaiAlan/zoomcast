import { toStreamLocalMs } from "../../shared/bundle/streamTime";
import type { Manifest } from "../../shared/bundle/manifest";
import type { TelemetryEvent } from "../../shared/bundle/types";
import type { CursorPath } from "../../shared/cursor/path";
import { cursorAt } from "../../shared/cursor/path";
import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { planExportFrames } from "../../shared/export/exportPlan";
import type { AudioInput } from "../../shared/export/ffmpegArgs";
import type { Project } from "../../shared/project/types";
import { outputSizeFor } from "../../shared/style/aspect";
import { zoomAt } from "../../shared/zoom/interpolate";
import type { Renderer } from "../gl/Renderer";
import type { VideoSource } from "./VideoSource";

export type ExportProgress = { done: number; total: number };

/**
 * Render the project to an MP4.
 *
 * Frames go through the SAME Renderer the preview uses, so what was on screen
 * is what lands in the file by construction rather than by discipline. The
 * renderer draws at the project's output size, which is also the size ffmpeg
 * was told to expect.
 */
export async function exportClip(opts: {
  manifest: Manifest;
  project: Project;
  /** Null when the bundle has no cursor telemetry — export just draws no cursor. */
  cursorPath: CursorPath | null;
  /**
   * The pre-filtered "down" events, exactly the array the preview's ripplesAt
   * draws from — not the raw telemetry stream. Passing the same array rather
   * than re-deriving it is what makes "preview and export draw from the same
   * data" true by construction instead of by discipline.
   */
  clicks: TelemetryEvent[];
  /** Resolved by the caller, so preview and export cannot disagree. */
  backgroundImageUrl?: string;
  mediaDir: string;
  renderer: Renderer;
  source: VideoSource;
  outFile: string;
  encoder: string;
  onProgress: (p: ExportProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<void> {
  const { manifest, project, cursorPath, clicks, renderer, source, outFile, onProgress } =
    opts;
  const { backgroundImageUrl } = opts;

  // Decode before the loop, never inside it. Export writes each frame once
  // with no repaint, so a frame that fell back to the solid colour while the
  // image was still decoding is baked into the file. The preview can afford
  // the fallback because it redraws; this cannot.
  if (backgroundImageUrl !== undefined) {
    await renderer.preloadBackgroundImage(backgroundImageUrl);

    // And insist it worked. Preloading without checking still bakes the
    // fallback colour into every frame of the file — silently, and for the
    // user-facing path rather than a diagnostic harness. Failing here costs
    // the user a re-export; not failing costs them a finished video with the
    // wrong background.
    if (renderer.backgroundImageFailed(backgroundImageUrl)) {
      throw new Error(
        "the background image could not be decoded, so the export would have " +
          "silently used the fallback colour instead. Re-pick the background " +
          "and try again.",
      );
    }
  }

  // Same helper the preview uses. Two call sites constructing this
  // separately is exactly the divergence verify:parity exists to catch.
  const output = outputSizeFor(project.output, {
    w: manifest.video.width,
    h: manifest.video.height,
  });
  const sourceSize = { w: manifest.video.width, h: manifest.video.height };

  const frames = planExportFrames(
    manifest.durationMs,
    project.cuts,
    project.output.fps,
  );

  const audio: AudioInput[] = manifest.audio.map((track) => ({
    file: `${opts.mediaDir}/${track.file}`,
    gainDb: track.role === "mic" ? project.audio.micGainDb : project.audio.systemGainDb,
    startOffsetMs: track.startOffsetMs,
  }));

  const id = await window.zoomcast.exportStart({
    width: output.w,
    height: output.h,
    fps: project.output.fps,
    bitrateMbps: project.output.bitrateMbps,
    encoder: opts.encoder,
    durationMs: manifest.durationMs,
    cuts: project.cuts,
    audio,
    syncNudgeMs: project.audio.syncNudgeMs,
    outFile,
  });

  try {
    for (const frame of frames) {
      if (opts.signal?.cancelled === true) {
        await window.zoomcast.exportCancel(id, `cancelled by user at frame ${frame.index}`);
        return;
      }

      // The screen track is the reference, so this is the identity today. It
      // goes through the helper anyway so a non-zero offset cannot be missed.
      const localMs = toStreamLocalMs(frame.tSourceMs, manifest.video.startOffsetMs);

      const sample = cursorPath === null ? null : cursorAt(cursorPath, frame.tSourceMs);

      const videoFrame = await source.frameAt(localMs);
      try {
        renderer.drawFrame({
          screen: videoFrame,
          zoom: zoomAt(project.zoom.keyframes, frame.tSourceMs),
          style: project.style,
          outputSize: output,
          sourceSize,
          cursor: sample === null ? undefined : { sample, style: project.style.cursor },
          ripples: ripplesAt(clicks, frame.tSourceMs, RIPPLE_DURATION_MS),
          backgroundImageUrl,
        });
      } finally {
        videoFrame.close();
      }

      await window.zoomcast.exportFrame(id, renderer.readPixels(output));

      if (frame.index % 10 === 0 || frame.index === frames.length - 1) {
        onProgress({ done: frame.index + 1, total: frames.length });
      }
    }

    await window.zoomcast.exportFinish(id);
    onProgress({ done: frames.length, total: frames.length });
  } catch (err) {
    await window.zoomcast.exportCancel(
      id,
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    throw err;
  }
}
