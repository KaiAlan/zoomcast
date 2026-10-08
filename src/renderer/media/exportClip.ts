import { captionAt, outputCaptions } from "../../shared/captions/timing";
import { cursorFrameAt } from "../../shared/cursor/effects";
import { openExportFrameWriter, type ExportFrameWriter } from "./ExportFrameWriter";
import { webcamTime } from "../../shared/webcam/layout";
import { toStreamLocalMs } from "../../shared/bundle/streamTime";
import type { Manifest } from "../../shared/bundle/manifest";
import type { TelemetryEvent } from "../../shared/bundle/types";
import type { CursorPath } from "../../shared/cursor/path";

import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { planExportFrames } from "../../shared/export/exportPlan";
import type { AudioInput } from "../../shared/export/ffmpegArgs";
import type { Project } from "../../shared/project/types";
import { outputSizeFor } from "../../shared/style/aspect";
import { zoomAt } from "../../shared/zoom/interpolate";
import type { Renderer } from "../gl/Renderer";
import { BLUR_GRID_MS, blurForCamera } from "../../shared/style/motionBlur";
import type { VideoSource } from "./VideoSource";

/** CPU wall times; queued GPU work may be charged to readback rather than draw. */
export type ExportTimings = {
  pipelined: boolean;
  frames: number;
  totalMs: number;
  setupMs: number;
  decodeMs: number;
  drawMs: number;
  readbackMs: number;
  transferAndWriteMs: number;
  progressMs: number;
  finishMs: number;
};

export type ExportProgress = { done: number; total: number; phase: "rendering" | "finishing" | "done" };

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
  webcamSource?: VideoSource;
  outFile: string;
  encoder: string;
  onProgress: (p: ExportProgress) => void;
  signal?: { cancelled: boolean };
  onTimings?: (timings: ExportTimings) => void;
}): Promise<boolean> {
  const startedAt = performance.now();
  const isCancelled = (): boolean => opts.signal?.cancelled === true;
  const timings: ExportTimings = {
    pipelined: true, frames: 0, totalMs: 0, setupMs: 0, decodeMs: 0, drawMs: 0,
    readbackMs: 0, transferAndWriteMs: 0, progressMs: 0, finishMs: 0,
  };
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

  const captionCues = outputCaptions(project, manifest.durationMs);
  const frames = planExportFrames(
    manifest.durationMs,
    project.cuts,
    project.output.fps,
    project.clips,
  );

  if (frames.length === 0) throw new Error("Add a clip before exporting.");

  const audio: AudioInput[] = manifest.audio.map((track) => ({
    file: `${opts.mediaDir}/${track.file}`,
    gainDb: track.role === "mic" ? project.audio.micGainDb : project.audio.systemGainDb,
    startOffsetMs: track.startOffsetMs,
  }));

  const id = await window.zoomcast.exportStart({
    inputBottomUp: true,
    width: output.w,
    height: output.h,
    fps: project.output.fps,
    bitrateMbps: project.output.bitrateMbps,
    encoder: opts.encoder,
    durationMs: manifest.durationMs,
    cuts: project.cuts,
    clips: project.clips,
    audio,
    syncNudgeMs: project.audio.syncNudgeMs,
    outFile,
  });

  let writer: ExportFrameWriter | undefined;
  let pendingWrite: Promise<void> | undefined;
  const drainWrite = async (): Promise<void> => {
    if (!pendingWrite) return;
    const pending = pendingWrite;
    pendingWrite = undefined;
    const waitAt = performance.now();
    await pending;
    timings.transferAndWriteMs += performance.now() - waitAt;
    timings.frames++;
  };
  try {
    writer = await openExportFrameWriter(id);
    timings.setupMs = performance.now() - startedAt;
    for (const frame of frames) {
      if (isCancelled()) {
        await window.zoomcast.exportCancel(id, `cancelled by user at frame ${frame.index}`);
        return false;
      }

      // The screen track is the reference, so this is the identity today. It
      // goes through the helper anyway so a non-zero offset cannot be missed.
      const localMs = toStreamLocalMs(frame.tSourceMs, manifest.video.startOffsetMs);

      const cursorFrame = cursorFrameAt(cursorPath, clicks, frame.tSourceMs, project.style.cursor, { durationMs: manifest.durationMs, cuts: project.cuts, clips: project.clips, outputMs: frame.tOutputMs, fps: project.output.fps });

      const decodeAt = performance.now();
      const videoFrame = await source.frameAt(localMs);
      let cameraFrame: Awaited<ReturnType<VideoSource["frameAt"]>> | undefined;
      try {
        const camera = opts.webcamSource;
        const cameraMs = camera && manifest.webcam && project.webcam.visible
          ? webcamTime(frame.tSourceMs, manifest.webcam.startOffsetMs, camera.durationMs) : null;
        if (camera && cameraMs !== null) cameraFrame = await camera.frameAt(cameraMs);
        timings.decodeMs += performance.now() - decodeAt;
        const drawAt = performance.now();
        // The same fixed grid the preview uses. Real elapsed time here would
        // make a 30fps export disagree with a 60fps preview and fail parity.
        const zoomNow = zoomAt(project.zoom.keyframes, frame.tSourceMs);
        const zoomPrev = zoomAt(project.zoom.keyframes, frame.tSourceMs - BLUR_GRID_MS);

        renderer.drawFrame({
          screen: videoFrame.image,
          caption: project.captions ? { text: captionAt(captionCues, frame.tOutputMs) ?? "", style: project.captions.style } : undefined,
          webcam: cameraFrame && opts.webcamSource ? { image: cameraFrame.image, sourceSize: { w: opts.webcamSource.width, h: opts.webcamSource.height }, config: project.webcam } : undefined,
          zoom: zoomNow,
          motionBlur: blurForCamera(zoomPrev, zoomNow, output, project.style.motionBlurAmount),
          style: project.style,
          outputSize: output,
          sourceSize,
          cursor: cursorFrame === null ? undefined : { ...cursorFrame, style: project.style.cursor },
          ripples: ripplesAt(clicks, frame.tSourceMs, RIPPLE_DURATION_MS),
          backgroundImageUrl,
        });
        timings.drawMs += performance.now() - drawAt;
      } finally {
        cameraFrame?.release();
        videoFrame.release();
      }

      const readbackAt = performance.now();
      const pixels = renderer.readPixels(output, false);
      timings.readbackMs += performance.now() - readbackAt;
      // Prepare at most one next frame while the previous encoder write runs.
      // The port cloned the previous pixels, so this read cannot overwrite its write.
      await drainWrite();
      if (isCancelled()) {
        await window.zoomcast.exportCancel(id, `cancelled before writing frame ${frame.index}`);
        return false;
      }
      const transferAt = performance.now();
      pendingWrite = writer.write(pixels);
      timings.transferAndWriteMs += performance.now() - transferAt;
      // A write can fail while decoding the next frame. Observe the rejection
      // immediately; drainWrite still propagates it before any subsequent write.
      void pendingWrite.catch(() => undefined);
      const progressAt = performance.now();

      if (frame.index % 10 === 0 || frame.index === frames.length - 1) {
        onProgress({ done: timings.frames, total: frames.length, phase: "rendering" });
      }
      timings.progressMs += performance.now() - progressAt;
    }

    await drainWrite();
    if (isCancelled()) {
      await window.zoomcast.exportCancel(id, "cancelled before finishing");
      return false;
    }
    const finishAt = performance.now();
    onProgress({ done: frames.length, total: frames.length, phase: "finishing" });
    await window.zoomcast.exportFinish(id);
    timings.finishMs = performance.now() - finishAt;
    timings.totalMs = performance.now() - startedAt;
    onProgress({ done: frames.length, total: frames.length, phase: "done" });
    opts.onTimings?.(timings);
    return true;
  } catch (err) {
    await window.zoomcast.exportCancel(
      id,
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    throw err;
  } finally {
    writer?.close();
  }
}
