import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planExportFrames } from "../../src/shared/export/exportPlan";
import type { ExportArgsOptions } from "../../src/shared/export/ffmpegArgs";
import { runExport } from "../../src/main/exportRunner";

const FIXTURE = join(process.cwd(), "tests", "fixtures", "basic");
const TMP = join(process.cwd(), "tmp");

const probe = (
  file: string,
  entries: string,
  stream: string,
  countFrames = false,
): string =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      ...(countFrames ? ["-count_frames"] : []),
      "-select_streams",
      stream,
      "-show_entries",
      entries,
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  ).trim();

/**
 * The encoders ffmpeg on this machine can actually use.
 *
 * The export button hardcodes h264_amf and every automated check hardcoded
 * libx264, so the encoder users actually get was the one nothing had ever
 * tested — the same shape as phase A shipping five broken cursor shapes
 * because the fixture emitted no cursor events.
 *
 * Probed with a one-frame encode, not read off `ffmpeg -encoders`: that lists
 * what was compiled in, and the static builds CI installs carry h264_amf on
 * runners with no AMD driver, where it fails at init. Empty when ffmpeg is
 * not on PATH at all: the suite below is then skipped rather than failing at
 * collection, so `npm test` still means something on a machine without it.
 */
function availableEncoders(): string[] {
  const works = (encoder: string): boolean => {
    try {
      execFileSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "color=s=320x180:r=30", "-frames:v", "1",
         "-c:v", encoder, "-f", "null", "-"],
        { stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  };
  return ["libx264", "h264_amf"].filter(works);
}

const encoders = availableEncoders();

describe.skipIf(encoders.length === 0)("export end to end", () => {
  it.each(encoders)("produces a playable mp4 with video and mixed, cut-aware audio (%s)", async (encoder) => {
    // Each encoder writes its own file: sharing one path would race, and the
    // second run would assert against the first one's output.
    const OUT = join(TMP, `e2e-export-${encoder}.mp4`);

    mkdirSync(TMP, { recursive: true });
    rmSync(OUT, { force: true });

    const durationMs = 5000;
    const cuts = [{ id: "c1", startMs: 1000, endMs: 2000 }];
    const fps = 30;
    const width = 320;
    const height = 180;

    const frames = planExportFrames(durationMs, cuts, fps);

    const opts: ExportArgsOptions = {
      width,
      height,
      fps,
      bitrateMbps: 2,
      encoder,
      durationMs,
      cuts,
      audio: [
        { file: join(FIXTURE, "mic.webm"), gainDb: 0, startOffsetMs: 142 },
        { file: join(FIXTURE, "system.webm"), gainDb: -6, startOffsetMs: 138 },
      ],
      syncNudgeMs: 0,
      outFile: OUT,
    };

    await runExport(opts, frames, (frame) => {
      // a brightness ramp keyed off the frame index, so the file is not blank
      const buf = new Uint8Array(width * height * 4);
      buf.fill(Math.floor((frame.index / Math.max(frames.length, 1)) * 255));
      return Promise.resolve(buf);
    });

    expect(existsSync(OUT)).toBe(true);

    // 5000ms minus a 1000ms cut = 4000ms at 30fps = 120 frames
    expect(frames).toHaveLength(120);
    expect(Number(probe(OUT, "stream=nb_read_frames", "v:0", true))).toBe(120);

    const duration = Number(probe(OUT, "format=duration", "v:0"));
    expect(duration).toBeGreaterThan(3.8);
    expect(duration).toBeLessThan(4.3);

    expect(probe(OUT, "stream=codec_name", "a:0")).toBe("aac");

    // The tags are what tells a player which matrix to decode with. Probed per
    // encoder: libx264 writes VUI itself; h264_amf is the one users get.
    expect(probe(OUT, "stream=color_space", "v:0")).toBe("bt709");
    expect(probe(OUT, "stream=color_primaries", "v:0")).toBe("bt709");
    expect(probe(OUT, "stream=color_transfer", "v:0")).toBe("bt709");
  }, 120_000);
  it.each(encoders)("ends with the video when audio source continues longer (%s)", async (encoder) => {
    const outFile = join(TMP, `e2e-audio-tail-${encoder}.mp4`);
    const opts: ExportArgsOptions = {
      width: 320, height: 180, fps: 30, bitrateMbps: 2, encoder,
      durationMs: 2500, cuts: [{ id: "tail-cut", startMs: 1000, endMs: 1500 }],
      audio: [{ file: join(FIXTURE, "mic.webm"), gainDb: 0, startOffsetMs: -500 }],
      syncNudgeMs: 0, outFile,
    };
    mkdirSync(TMP, { recursive: true });
    await runExport(opts, planExportFrames(opts.durationMs, opts.cuts, opts.fps),
      () => Promise.resolve(new Uint8Array(320 * 180 * 4)));
    expect(Number(probe(outFile, "stream=nb_read_frames", "v:0", true))).toBe(60);
    expect(Number(probe(outFile, "format=duration", "v:0"))).toBeLessThanOrEqual(2.05);
    expect(probe(outFile, "stream=codec_name", "a:0")).toBe("aac");
  }, 120_000);

});
