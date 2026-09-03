import { BrowserWindow, dialog, ipcMain } from "electron";
import type { Project } from "../shared/project/types";
import { openBundle, saveProject } from "./bundleIo";

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
}
