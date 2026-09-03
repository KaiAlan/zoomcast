import { spawn } from "node:child_process";
import type { ExportFrame } from "../shared/export/exportPlan";
import { buildExportArgs, type ExportArgsOptions } from "../shared/export/ffmpegArgs";
import { resolveFfmpeg } from "./ffmpeg";

export type FrameSource = (frame: ExportFrame) => Promise<Uint8Array>;

/**
 * Render frames into ffmpeg's stdin.
 *
 * Backpressure is not optional: a 1080p RGBA frame is ~8MB, so ignoring
 * `write()` returning false would try to buffer roughly 30GB for a one-minute
 * export.
 */
export async function runExport(
  opts: ExportArgsOptions,
  frames: ExportFrame[],
  frameSource: FrameSource,
): Promise<void> {
  const bin = resolveFfmpeg();
  const args = buildExportArgs(opts);
  const child = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const finished = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
  });

  let writeFailed = false;
  child.stdin.on("error", () => {
    // ffmpeg died early; the close handler reports the real reason
    writeFailed = true;
  });

  try {
    for (const frame of frames) {
      if (writeFailed) break;

      const buf = await frameSource(frame);
      if (!child.stdin.write(buf)) {
        await new Promise<void>((resolve) => child.stdin.once("drain", resolve));
      }
    }
  } finally {
    child.stdin.end();
  }

  await finished;
}
