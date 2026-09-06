import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ExportStartOptions } from "../shared/api";
import { formatExportFailure, formatExportStart } from "../shared/export/diagnostics";
import type { Project } from "../shared/project/types";
import { openBundle, saveProject } from "./bundleIo";
import { loadSettings, saveSettings } from "./settingsStore";
import type { Settings } from "../shared/settings/types";
import { isRecording } from "./capture/SessionController";
import { ExportSession } from "./exportRunner";
import { logDiag } from "./log";
import { listRecordings, recordHotkeyLabel, toggleRecording } from "./recording";

const sessions = new Map<string, ExportSession>();

export function registerIpc(): void {
  ipcMain.handle("bundle:pick", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result =
      win === undefined
        ? await dialog.showOpenDialog({ properties: ["openDirectory"] })
        : await dialog.showOpenDialog(win, { properties: ["openDirectory"] });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("bundle:open", (_event, dir: string) => openBundle(dir));

  ipcMain.handle("bundle:save", (_event, dir: string, project: Project) => {
    saveProject(dir, project);
  });

  ipcMain.handle("background:choose", async (_event, dir: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: "choose a background image",
      properties: ["openFile" as const],
      filters: [{ name: "images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    };

    const result =
      win === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(win, options);

    const src = result.canceled ? undefined : result.filePaths[0];
    if (src === undefined) return null;

    // Copied into the project, never referenced: spec §5, so a project does not
    // break when the source file is moved, renamed or deleted. Timestamped so
    // replacing the image cannot collide with a texture still cached under the
    // old name.
    const name = `background-${Date.now()}${extname(src).toLowerCase()}`;
    try {
      copyFileSync(src, join(dir, name));
    } catch (err) {
      logDiag("background:choose", err);
      return null;
    }

    return name;
  });

  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:set", (_event, settings: Settings) => {
    saveSettings(settings);
  });

  ipcMain.handle("recording:list", () => listRecordings());
  ipcMain.handle("recording:hotkey", () => recordHotkeyLabel());
  ipcMain.handle("recording:toggle", () => toggleRecording());
  ipcMain.handle("recording:isActive", () => isRecording());

  ipcMain.handle("export:pick", async (_event, suggested: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      defaultPath: suggested,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    };

    const result =
      win === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(win, options);

    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle("export:start", (_event, opts: ExportStartOptions) => {
    const id = randomUUID();
    logDiag("export:start", `${id} ${formatExportStart(opts)}`);
    sessions.set(id, ExportSession.start(opts));
    return id;
  });

  ipcMain.handle("export:frame", async (_event, id: string, frame: Uint8Array) => {
    const session = sessions.get(id);
    if (session === undefined) throw new Error(`no export session ${id}`);
    await session.write(frame);
  });

  ipcMain.handle("export:finish", async (_event, id: string) => {
    const session = sessions.get(id);
    if (session === undefined) throw new Error(`no export session ${id}`);
    try {
      await session.finish();
      logDiag("export:finish", `${id} ok`);
    } catch (err) {
      logDiag(
        "export:finish",
        `${id} ${formatExportFailure(String(err), session.stderrTail())}`,
      );
      throw err;
    } finally {
      sessions.delete(id);
    }
  });

  ipcMain.handle("export:cancel", (_event, id: string, reason: string) => {
    const session = sessions.get(id);
    if (session !== undefined) {
      logDiag(
        "export:cancel",
        `${id} ${formatExportFailure(reason, session.stderrTail())}`,
      );
      session.cancel();
    }
    sessions.delete(id);
  });
}
