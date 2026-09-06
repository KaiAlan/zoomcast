/**
 * Encode the same synthetic frames through each encoder and report fps.
 *
 * Not a test: it measures the machine, so it has no assertion to make. It
 * exists because the export button's encoder was chosen on the assumption that
 * hardware wins, and the note recording that decision carried a figure
 * (~8fps, 0.13x realtime for h264_amf) that a real export later contradicted
 * by a factor of four.
 *
 * This measures ENCODING ONLY — no GL render, no IPC — so it is a ceiling
 * rather than the rate an export achieves.
 *
 * Run: npm run bench:encoders
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { planExportFrames } from "../src/shared/export/exportPlan";
import type { ExportArgsOptions } from "../src/shared/export/ffmpegArgs";
import { runExport } from "../src/main/exportRunner";

const TMP = join(process.cwd(), "tmp", "bench");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const DURATION_MS = 10_000;

async function bench(encoder: string): Promise<void> {
  const frames = planExportFrames(DURATION_MS, [], FPS);
  const opts: ExportArgsOptions = {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    bitrateMbps: 12,
    encoder,
    durationMs: DURATION_MS,
    cuts: [],
    audio: [],
    syncNudgeMs: 0,
    outFile: join(TMP, `${encoder}.mp4`),
  };

  // One buffer, refilled per frame: allocating 8MB 600 times would measure the
  // allocator as much as the encoder.
  const buf = new Uint8Array(WIDTH * HEIGHT * 4);
  const started = Date.now();

  await runExport(opts, frames, (frame) => {
    buf.fill(frame.index % 255);
    return Promise.resolve(buf);
  });

  const seconds = (Date.now() - started) / 1000;
  const fps = frames.length / seconds;
  console.log(
    `${encoder.padEnd(10)} ${frames.length} frames in ${seconds.toFixed(1)}s ` +
      `= ${fps.toFixed(1)}fps, ${(fps / FPS).toFixed(2)}x realtime`,
  );
}

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  for (const encoder of ["libx264", "h264_amf"]) {
    try {
      await bench(encoder);
    } catch (err) {
      console.log(`${encoder.padEnd(10)} FAILED: ${String(err)}`);
    }
  }
}

void main();
