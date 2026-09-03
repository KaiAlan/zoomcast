import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import type { ExportStartOptions } from "../shared/api";
import type { Project } from "../shared/project/types";
import { openBundle, saveProject } from "./bundleIo";
import { isRecording } from "./capture/SessionController";
import { ExportSession } from "./exportRunner";
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
    } finally {
      sessions.delete(id);
    }
  });

  ipcMain.handle("export:cancel", (_event, id: string) => {
    sessions.get(id)?.cancel();
    sessions.delete(id);
  });
}
