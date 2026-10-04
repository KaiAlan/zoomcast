import { BrowserWindow, ipcMain } from "electron";
import { createWriteStream, renameSync, type WriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { Manifest } from "../../shared/bundle/manifest";
import type { WebcamStart } from "../../shared/webcam/capture";
import { preloadPath, rendererUrl } from "../windows";
import { resolveFfmpeg } from "../ffmpeg";
import { probeRecording } from "./ScreenSource";

const run = promisify(execFile);

export class WebcamRecorder {
  private stream: WriteStream | null = null;
  private writeError: Error | null = null;
  private started: WebcamStart | null = null;
  private readonly raw: string;

  private constructor(private readonly win: BrowserWindow, private readonly dir: string) {
    this.raw = join(dir, "webcam.capture");
    ipcMain.handle("webcam:chunk", async (event, chunk: Uint8Array) => {
      if (event.sender.id !== win.webContents.id) throw new Error("invalid camera sender");
      if (this.stream === null) {
        this.stream = createWriteStream(this.raw);
        this.stream.on("error", (err) => { this.writeError = err; });
      }
      if (this.writeError !== null) throw this.writeError;
      await new Promise<void>((resolve, reject) => this.stream?.write(chunk, (err) => err ? reject(err) : resolve()));
    });
  }

  static async start(dir: string, deviceId: string): Promise<WebcamRecorder> {
    const win = new BrowserWindow({ show: false, webPreferences: {
      preload: preloadPath(), contextIsolation: true, nodeIntegration: false,
      sandbox: false, backgroundThrottling: false,
    } });
    const host = new WebcamRecorder(win, dir);
    try {
      await win.loadURL(rendererUrl("#webcam"));
      let ready = false;
      for (let i = 0; i < 100; i++) {
        ready = await win.webContents.executeJavaScript("window.__webcam !== undefined") as boolean;
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!ready) throw new Error("camera renderer did not become ready");
      host.started = await win.webContents.executeJavaScript(`window.__webcam.start(${JSON.stringify(deviceId)})`) as WebcamStart;
      return host;
    } catch (err) { await host.abort(); throw err; }
  }

  private async finish(): Promise<void> {
    try {
      if (!this.win.isDestroyed()) await this.win.webContents.executeJavaScript("window.__webcam?.stop()");
    } finally {
      ipcMain.removeHandler("webcam:chunk");
      if (!this.win.isDestroyed()) this.win.destroy();
      if (this.stream !== null) {
        const stream = this.stream;
        await new Promise<void>((resolve, reject) => {
          if (stream.destroyed) { resolve(); return; }
          stream.once("error", reject);
          stream.end(() => resolve());
        });
      }
    }
    if (this.writeError !== null) throw this.writeError;
  }

  async stop(clockBaseMs: number): Promise<NonNullable<Manifest["webcam"]>> {
    await this.finish();
    if (this.started === null || this.stream === null) throw new Error("camera produced no frames");
    const file = "webcam.mp4";
    if (this.started.mimeType.startsWith("video/mp4")) renameSync(this.raw, join(this.dir, file));
    else {
      // VP9 remux only: no generation loss or recording-length transcode.
      await run(resolveFfmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-i", this.raw, "-an", "-c:v", "copy", "-movflags", "+faststart", join(this.dir, file)], { timeout: 30_000 });
      renameSync(this.raw, join(this.dir, "webcam.webm"));
    }
    const info = await probeRecording(join(this.dir, file));
    return { file, width: info.width, height: info.height, fps: info.fps, startOffsetMs: this.started.startedAtUnixMs - clockBaseMs };
  }

  async abort(): Promise<void> { try { await this.finish(); } catch { /* best-effort cleanup */ } }
}
