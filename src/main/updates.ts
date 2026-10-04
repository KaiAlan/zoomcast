import { app, BrowserWindow, dialog, ipcMain, net } from "electron";
import updater from "electron-updater";
import { randomUUID } from "node:crypto";
import { isRecording } from "./capture/SessionController";
import { hasActiveExports } from "./exportJobs";
import { recorderIsBusy } from "./recorderWidget";
import { UpdateController } from "./updateController";
import { logDiag } from "./log";
import { UPDATE_REPOSITORY } from "../shared/updates";
import { canStoreUpdateAccess, readUpdateAccess, storeUpdateAccess } from "./updateAccess";

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
  let token = readUpdateAccess();
  const configure = (): void => {
    if (token) updater.autoUpdater.setFeedURL({ provider: "github", ...UPDATE_REPOSITORY, token });
  };
  configure();
  // Provider errors can contain request details; never log credentials.
  const redact = (value: unknown): string => {
    const text = value instanceof Error ? value.message : String(value);
    return token ? text.replaceAll(token, "[redacted]") : text;
  };
  updater.autoUpdater.logger = {
    info: () => undefined, debug: () => undefined,
    warn: message => logDiag("updates", redact(message)),
    error: message => logDiag("updates", redact(message)),
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
      : hasActiveExports() ? "Wait for your exports to finish before restarting to update." : null,
    confirm: async () => (await dialog.showMessageBox({
      type: "question", title: "Update Zoomcast", message: "Restart to install the update?",
      detail: "Your open projects will be saved. Zoomcast will close and reopen after installation.",
      buttons: ["Restart to update", "Later"], defaultId: 0, cancelId: 1,
    })).response === 0,
    save: saveOpenProjects,
    log: error => logDiag("updates", redact(error)),
    accessReady: () => token !== null,
  });
  ipcMain.handle("updates:state", () => controller?.state());
  ipcMain.handle("updates:check", () => controller?.check());
  ipcMain.handle("updates:download", () => controller?.download());
  ipcMain.handle("updates:install", () => controller?.install());
  ipcMain.handle("updates:access", () => ({ configured: token !== null, canStore: canStoreUpdateAccess() }));
  ipcMain.handle("updates:set-access", async (_event, value: unknown) => {
    if (controller?.isBusy() || controller?.state().status === "downloaded") {
      throw new Error("Finish this update before changing update access.");
    }
    if (value !== null) {
      if (typeof value !== "string" || value.length < 20 || value.length > 256 || /\s/.test(value)) throw new Error("Enter a valid GitHub access token.");
      const response = await net.fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases?per_page=1`, {
        headers: { Authorization: `Bearer ${value}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(15000),
      }).catch(() => { throw new Error("Could not verify update access. Check your connection."); });
      if (!response.ok) throw new Error("This token cannot read Zoomcast releases. Check its repository access and permissions.");
      await response.body?.cancel();
    }
    if (controller?.isBusy() || controller?.state().status === "downloaded") {
      throw new Error("Finish this update before changing update access.");
    }
    storeUpdateAccess(value);
    token = value;
    configure();
    await controller?.check();
  });
  if (enabled) {
    const initial = setTimeout(() => void controller?.check(), 5000);
    const periodic = setInterval(() => void controller?.check(), 6 * 60 * 60 * 1000);
    app.once("will-quit", () => { clearTimeout(initial); clearInterval(periodic); });
  }
}
