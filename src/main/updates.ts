import { captionsAreBusy } from "./captions/ipc";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import updater from "electron-updater";
import { randomUUID } from "node:crypto";
import { isRecording } from "./capture/SessionController";
import { hasActiveExports } from "./exportJobs";
import { recorderIsBusy } from "./recorderWidget";
import { UpdateController } from "./updateController";
import { logDiag } from "./log";
import { rmSync } from "node:fs";
import { join } from "node:path";

let controller: UpdateController | null = null;
export const isInstallingUpdate = (): boolean => controller?.isInstalling() ?? false;

/** Wait for every editor to save; no download URL or executable comes from IPC. */
async function saveOpenProjects(): Promise<void> {
  const editors = BrowserWindow.getAllWindows().filter(win =>
    !["#export", "#recorder", "#audio", "#webcam", "#settings", "#shoot"].some(hash => win.webContents.getURL().endsWith(hash)));
  await Promise.all(editors.map(win => new Promise<void>((resolve, reject) => {
    const token = randomUUID();
    const finish = (error?: string): void => {
      clearTimeout(timer);
      ipcMain.removeListener("updates:saved", saved);
      if (error) reject(new Error(error)); else resolve();
    };
    const saved = (event: Electron.IpcMainEvent, reply: string, error?: string): void => {
      if (event.sender.id === win.webContents.id && reply === token) finish(error);
    };
    const timer = setTimeout(() => finish("Editor did not save before update"), 10000);
    ipcMain.on("updates:saved", saved);
    win.webContents.send("updates:prepare", token);
  })));
}

export function registerUpdates(enabled: boolean): void {
  // Releases contain a complete NSIS installer, never a web installer.
  updater.autoUpdater.disableWebInstaller = true;
  // Public releases use the packaged app-update.yml, without credentials.
  // Remove credentials left by versions that required private-release access.
  try {
    rmSync(join(app.getPath("userData"), "update-access.bin"), { force: true });
    rmSync(join(app.getPath("userData"), "update-access.bin.new"), { force: true });
  } catch { logDiag("updates", "Could not remove legacy update access."); }
  const message = (value: unknown): string => value instanceof Error ? value.message : String(value);
  updater.autoUpdater.logger = {
    info: () => undefined, debug: () => undefined,
    warn: message => logDiag("updates", String(message)),
    error: message => logDiag("updates", String(message)),
  };
  controller = new UpdateController({
    driver: updater.autoUpdater,
    enabled,
    currentVersion: app.getVersion(),
    changed: state => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.webContents.isDestroyed()) win.webContents.send("updates:changed", state);
      }
    },
    busyReason: () => isRecording() || recorderIsBusy()
      ? "Finish recording before restarting to update."
      : hasActiveExports() ? "Wait for your exports to finish before restarting to update."
      : captionsAreBusy() ? "Wait for your caption task to finish before restarting to update." : null,
    confirm: async () => (await dialog.showMessageBox({
      type: "question", title: "Update Zoomcast", message: "Restart to install the update?",
      detail: "Your open projects will be saved. Zoomcast will close and reopen after installation.",
      buttons: ["Restart to update", "Later"], defaultId: 0, cancelId: 1,
    })).response === 0,
    save: saveOpenProjects,
    log: error => logDiag("updates", message(error)),
  });
  ipcMain.handle("updates:state", () => controller?.state());
  ipcMain.handle("updates:check", () => controller?.check());
  ipcMain.handle("updates:download", () => controller?.download());
  ipcMain.handle("updates:install", () => controller?.install());
  if (enabled) {
    const initial = setTimeout(() => void controller?.check(), 5000);
    const periodic = setInterval(() => void controller?.check(), 6 * 60 * 60 * 1000);
    app.once("will-quit", () => { clearTimeout(initial); clearInterval(periodic); });
  }
}
