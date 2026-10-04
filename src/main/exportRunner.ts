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
  private framesWritten = 0;
  private bytesWritten = 0;
  private writeMs = 0;
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
    void this.finished.catch(() => undefined);
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
    if (this.writeFailed || stdin === null) throw new Error(`export encoder stopped\n${this.stderr}`);
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      stdin.write(buf, error => error ? reject(error) : resolve());
    });
    this.writeMs += performance.now() - startedAt;
    this.framesWritten++;
    this.bytesWritten += buf.byteLength;
  }

  writeTimings(): { frames: number; bytes: number; writeMs: number } {
    return { frames: this.framesWritten, bytes: this.bytesWritten, writeMs: this.writeMs };
  }

  async finish(): Promise<void> {
    this.child.stdin?.end();
    await this.finished;
  }

  cancel(): void {
    // A cancelled encoder rejects its completion promise; consume that outcome.
    void this.finished.catch(() => undefined);
    this.writeFailed = true;
    this.child.stdin?.end();
    this.child.kill();
  }

  /**
   * What ffmpeg has said so far.
   *
   * Read on cancel: cancel is the only path that leaves a truncated file, and
   * ffmpeg's explanation for it was being discarded with the session.
   */
  stderrTail(): string {
    return this.stderr;
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
