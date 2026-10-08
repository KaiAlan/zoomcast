import { app, BrowserWindow, dialog, ipcMain, Notification, powerMonitor, shell } from "electron";
import updater from "electron-updater";
import { randomUUID } from "node:crypto";
import { isRecording } from "./capture/SessionController";
import { hasActiveExports } from "./exportJobs";
import { recorderIsBusy } from "./recorderWidget";
import { UpdateController } from "./updateController";
import { logDiag } from "./log";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { UpdateHistory } from "./updateHistory";
import { scheduleUpdates } from "./updateSchedule";
import { releaseUrl, type ReleaseSummary, type UpdateState } from "../shared/updates";

declare const __ZOOMCAST_RELEASE__: ReleaseSummary;

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

export function registerUpdates(enabled: boolean, showUpdates: () => void): void {
  const history = new UpdateHistory(join(app.getPath("userData"), "update-history.json"), error => logDiag("updates:history", error));
  const installedRelease = __ZOOMCAST_RELEASE__.version === app.getVersion() ? __ZOOMCAST_RELEASE__ : undefined;
  const stateForUi = (state: UpdateState): UpdateState => ({
    ...state, installedRelease, showWhatsNew: !!installedRelease && !history.hasSeen(installedRelease.version),
  });
  const publish = (state: UpdateState): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send("updates:changed", stateForUi(state));
    }
  };
  let notification: Notification | null = null;
  const announce = (state: UpdateState): void => {
    if (!enabled || state.status !== "available" || !state.version || history.hasNotified(state.version)
      || isRecording() || recorderIsBusy() || !Notification.isSupported()) return;
    try {
      notification?.close();
      notification = new Notification({ title: "Zoomcast update available", body: `Version ${state.version} is available. Click to review and update.`, silent: true });
      notification.on("click", showUpdates);
      notification.show();
      history.markNotified(state.version);
    } catch (error) { logDiag("updates:notification", error); }
  };
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
      publish(state);
      announce(state);
    },
    busyReason: () => isRecording() || recorderIsBusy()
      ? "Finish recording before restarting to update."
      : hasActiveExports() ? "Wait for your exports to finish before restarting to update." : null,
    confirm: async () => (await dialog.showMessageBox({
      type: "question", title: "Update Zoomcast", message: "Restart to install the update?",
      detail: "Your open projects will be saved. Zoomcast will close and reopen after installation.",
      buttons: ["Restart to update", "Later"], defaultId: 0, cancelId: 1,
    })).response === 0,
    save: saveOpenProjects,
    log: error => logDiag("updates", message(error)),
  });
  ipcMain.handle("updates:state", () => controller && stateForUi(controller.state()));
  ipcMain.handle("updates:check", () => controller?.check());
  ipcMain.handle("updates:download", () => controller?.download());
  ipcMain.handle("updates:install", () => controller?.install());
  ipcMain.handle("updates:dismiss-whats-new", () => {
    if (installedRelease) history.markSeen(installedRelease.version);
    if (controller) publish(controller.state());
  });
  ipcMain.handle("updates:release-notes", async (_event, version: unknown) => {
    if (typeof version !== "string" || ![app.getVersion(), controller?.state().version].includes(version)) throw new Error("Unknown release version");
    await shell.openExternal(releaseUrl(version));
  });
  if (enabled) {
    const schedule = scheduleUpdates(() => controller?.check() ?? Promise.resolve());
    powerMonitor.on("resume", schedule.resume);
    // Defer notifications during recording; announce once work is idle.
    const deferred = setInterval(() => { if (controller) announce(controller.state()); }, 60000);
    app.once("will-quit", () => {
      schedule.stop(); clearInterval(deferred); notification?.close();
      powerMonitor.removeListener("resume", schedule.resume);
    });
  }
}
