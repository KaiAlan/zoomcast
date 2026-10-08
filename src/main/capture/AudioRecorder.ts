import { BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { logDiag } from "../log";
import { preloadPath, rendererUrl } from "../windows";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { AudioHealth } from "../../shared/recorder";
import type { MicrophoneSettings } from "../../shared/settings/types";

export type AudioRole = "mic" | "system";

export type AudioTrackResult = {
  role: AudioRole;
  file: string;
  startOffsetMs: number;
};

const FILE_FOR: Record<AudioRole, string> = {
  mic: "mic.webm",
  system: "system.webm",
};

/**
 * Answer getDisplayMedia from the renderer with the whole screen plus loopback
 * audio. Electron requires a main-process handler for this; without it the
 * renderer's request is simply denied and there is no system audio.
 */
export function registerDisplayMediaHandler(): void {
  // Media capture from a custom scheme is denied unless permission is granted
  // explicitly. Without this the mic request fails before any device is opened,
  // and the failure surfaces only as an empty audio track list.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });

  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === "media" || permission === "display-capture",
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          const screen = sources[0];
          if (screen === undefined) {
            logDiag("displayMedia", "no screen sources available");
            callback({});
            return;
          }
          callback({ video: screen, audio: "loopback" });
        })
        .catch((err: unknown) => {
          logDiag("displayMedia", err);
          callback({});
        });
    },
    // Chromium would otherwise show its own picker; this app always wants the
    // primary screen's loopback and never asks.
    { useSystemPicker: false },
  );
}

/**
 * Owns a hidden renderer that does the actual capture.
 *
 * Mic and system audio are Chromium APIs, so they cannot run in the main
 * process — but the recording session is orchestrated here. This class is the
 * bridge: it opens an offscreen window, tells it what to record, and appends
 * the chunks it sends back to disk.
 */
export class AudioRecorder {
  private readonly streams = new Map<AudioRole, WriteStream>();
  private readonly healthByRole: Partial<Record<AudioRole, AudioHealth>> = {};
  private readonly bytesWritten = new Map<AudioRole, number>();
  private lastHealthAt: Partial<Record<AudioRole, number>> = {};
  get health(): Partial<Record<AudioRole, AudioHealth>> {
    for (const role of ["mic", "system"] as const) {
      const health = this.healthByRole[role];
      if (health && health.status !== "failed" && Date.now() - (this.lastHealthAt[role] ?? Date.now()) > 8000) this.healthByRole[role] = { status: "failed", level: 0, message: "Audio recorder stopped responding. Stop the take and check your device." };
    }
    return this.healthByRole;
  }
  private readonly receiveHealth = (event: Electron.IpcMainEvent, role: AudioRole, health: AudioHealth): void => {
    if (event.sender !== this.win.webContents || !["mic", "system"].includes(role)) return;
    if (this.health[role]?.status === "failed") return;
    this.lastHealthAt[role] = Date.now();
    this.healthByRole[role] = health;
  };
  private offsets: AudioTrackResult[] = [];

  private constructor(
    private readonly win: BrowserWindow,
    private readonly dir: string,
  ) {}

  static async open(dir: string): Promise<AudioRecorder> {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Keeps the recorder running when the window is hidden and unfocused.
        backgroundThrottling: false,
      },
    });

    try { await win.loadURL(rendererUrl("#audio")); }
    catch (error) { win.destroy(); throw error; }

    win.webContents.on("console-message", (event) => {
      if (event.level === "error") logDiag("audioRenderer", event.message);
    });

    const recorder = new AudioRecorder(win, dir);
    recorder.attachChunkSink();

    let ready = false;
    try {
      for (let tries = 0; tries < 100; tries++) {
        ready = (await win.webContents.executeJavaScript(
          "typeof window.__audio === 'object' && window.__audio !== undefined",
        )) as boolean;
        if (ready) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }

      if (!ready) throw new Error("audio renderer never installed its hooks");
    } catch (error) { await recorder.stop(Date.now(), []); throw error; }

    return recorder;
  }

  private attachChunkSink(): void {
    ipcMain.on("audio:health", this.receiveHealth);
    ipcMain.removeHandler("audio:chunk");
    ipcMain.handle("audio:chunk", (event, role: AudioRole, chunk: Uint8Array) => {
      if (event.sender !== this.win.webContents || !["mic", "system"].includes(role)) throw new Error("Invalid audio source");
      let stream = this.streams.get(role);
      if (stream === undefined) {
        stream = createWriteStream(join(this.dir, FILE_FOR[role]));
        stream.on("error", (error) => { this.health[role] = { status: "failed", level: 0, message: "Audio could not be saved. Check available disk space and stop the take." }; logDiag(`audio:${role}:write`, error); });
        this.streams.set(role, stream);
      }
      const sink = stream;
      return new Promise<void>((resolve, reject) => {
        sink.write(chunk, error => {
          if (error) { reject(error); return; }
          this.bytesWritten.set(role, (this.bytesWritten.get(role) ?? 0) + chunk.byteLength);
          resolve();
        });
      });
    });
  }

  /**
   * Start the requested roles, returning what actually started.
   *
   * `clockBaseUnixMs` is the screen capture's first frame. Audio is started
   * before the screen so nothing is missed at the head of a take, which makes
   * these offsets negative — the same convention `toStreamLocalMs` uses, and
   * one ffmpeg's `-itsoffset` accepts directly.
   */
  async start(roles: AudioRole[], settings?: MicrophoneSettings): Promise<Array<{ role: AudioRole; startedAtUnixMs: number }>> {
    const results = (await this.win.webContents.executeJavaScript(
      `window.__audio.start(${JSON.stringify(roles)}, ${JSON.stringify(settings)})`,
    )) as Array<{ role: AudioRole; startedAtUnixMs: number; ok: boolean; error?: string }>;

    const started: Array<{ role: AudioRole; startedAtUnixMs: number }> = [];

    for (const r of results) {
      if (r.ok) started.push({ role: r.role, startedAtUnixMs: r.startedAtUnixMs });
      // A missing track degrades the recording; it never aborts it.
      else { this.health[r.role] = { status: "failed", level: 0, message: r.error ?? "Audio could not start" }; logDiag(`audio:${r.role}`, r.error ?? "unknown failure"); }
    }

    return started;
  }

  async stop(clockBaseUnixMs: number, started: Array<{ role: AudioRole; startedAtUnixMs: number }>): Promise<AudioTrackResult[]> {
    try {
      await this.win.webContents.executeJavaScript("window.__audio.stop()");
    } catch {
      // The window may already be gone; the streams still need closing.
    }

    for (const stream of this.streams.values()) {
      if (!stream.destroyed) await new Promise<void>((resolve) => { stream.once("error", () => resolve()); stream.end(resolve); });
    }

    this.offsets = started
      .filter((s) => (this.bytesWritten.get(s.role) ?? 0) > 0)
      .map((s) => ({
        role: s.role,
        file: FILE_FOR[s.role],
        startOffsetMs: Math.round(s.startedAtUnixMs - clockBaseUnixMs),
      }));

    ipcMain.removeHandler("audio:chunk");
    ipcMain.removeListener("audio:health", this.receiveHealth);
    if (!this.win.isDestroyed()) this.win.destroy();

    return this.offsets;
  }
}
