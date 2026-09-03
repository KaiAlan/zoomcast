import { type ChildProcess, spawn } from "node:child_process";
import type { ExportFrame } from "../shared/export/exportPlan";
import { buildExportArgs, type ExportArgsOptions } from "../shared/export/ffmpegArgs";
import { resolveFfmpeg } from "./ffmpeg";

export type FrameSource = (frame: ExportFrame) => Promise<Uint8Array>;

/**
 * A running ffmpeg export that frames are pushed into.
 *
 * Streaming rather than pull-based because the frames are rendered in the
 * renderer process: it owns the GL context, so it has to drive, and each
 * `write` resolving is what gives it backpressure across the IPC boundary.
 */
export class ExportSession {
  private stderr = "";
  private writeFailed = false;
  private readonly finished: Promise<void>;

  private constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr += chunk;
    });

    // ffmpeg dying early makes further writes throw; the close handler below
    // reports the real reason.
    child.stdin?.on("error", () => {
      this.writeFailed = true;
    });

    this.finished = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}\n${this.stderr}`));
      });
    });
  }

  static start(opts: ExportArgsOptions): ExportSession {
    const child = spawn(resolveFfmpeg(), buildExportArgs(opts), {
      stdio: ["pipe", "ignore", "pipe"],
    });
    return new ExportSession(child);
  }

  /**
   * Backpressure is not optional: a 1080p RGBA frame is ~8MB, so ignoring
   * `write()` returning false would try to buffer roughly 30GB for a
   * one-minute export.
   */
  async write(buf: Uint8Array): Promise<void> {
    const stdin = this.child.stdin;
    if (this.writeFailed || stdin === null) return;

    if (!stdin.write(buf)) {
      await new Promise<void>((resolve) => stdin.once("drain", resolve));
    }
  }

  async finish(): Promise<void> {
    this.child.stdin?.end();
    await this.finished;
  }

  cancel(): void {
    this.writeFailed = true;
    this.child.stdin?.end();
    this.child.kill();
  }
}

/** Convenience wrapper used by the end-to-end test. */
export async function runExport(
  opts: ExportArgsOptions,
  frames: ExportFrame[],
  frameSource: FrameSource,
): Promise<void> {
  const session = ExportSession.start(opts);

  try {
    for (const frame of frames) {
      await session.write(await frameSource(frame));
    }
  } catch (err) {
    session.cancel();
    throw err;
  }

  await session.finish();
}
