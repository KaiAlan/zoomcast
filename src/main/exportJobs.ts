import { BrowserWindow, ipcMain, Notification, type Notification as NotificationType } from "electron";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ExportJob, ExportJobUpdate, ExportRequest } from "../shared/export/jobs";
import { exportFinished } from "../shared/export/jobs";
import { preloadPath, rendererUrl } from "./windows";

const jobs = new Map<string, { job: ExportJob; request: ExportRequest; win: BrowserWindow; ownerId: number; notification?: NotificationType }>();
const snapshot = (): ExportJob[] => [...jobs.values()].map(value => ({ ...value.job }));
export const hasActiveExports = (): boolean => [...jobs.values()].some(value => !exportFinished(value.job.phase));
const broadcast = (): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("exports:changed", snapshot());
};
let openEditor: (() => void) | null = null;
export function registerExportViewer(open: () => void): void { openEditor = open; }
function show(id: string): void {
  const value = jobs.get(id);
  if (!value) return;
  let owner = BrowserWindow.fromId(value.ownerId);
  if (!owner) {
    openEditor?.();
    owner = BrowserWindow.getAllWindows().find(win => !["#export", "#recorder", "#audio", "#webcam", "#settings"].some(hash => win.webContents.getURL().includes(hash))) ?? null;
  }
  if (!owner) return;
  if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus();
  if (owner.webContents.isLoading()) owner.webContents.once("did-finish-load", () => setTimeout(() => owner?.webContents.send("exports:open", id), 150));
  else owner.webContents.send("exports:open", id);
}
export function registerExportJobs(): void {
  ipcMain.handle("exports:start", async (event, request: ExportRequest) => {
    const id = randomUUID();
    const win = new BrowserWindow({ width: 900, height: 820, minWidth: 480, minHeight: 620,
      show: false, title: "Export worker — Zoomcast", backgroundColor: "#f5f6f8", webPreferences: {
        preload: preloadPath(), contextIsolation: true, nodeIntegration: false,
        sandbox: false, backgroundThrottling: false,
      },
    });
    const job: ExportJob = { id, phase: "preparing", done: 0, total: 0, startedAt: Date.now(), file: request.outFile };
    jobs.set(id, { job, request, win, ownerId: BrowserWindow.fromWebContents(event.sender)?.id ?? 0 });
    win.on("close", event => { if (!exportFinished(job.phase)) { event.preventDefault(); win.hide(); } });
    win.webContents.on("render-process-gone", (_event, details) => {
      if (!exportFinished(job.phase)) { job.phase = "failed"; job.error = `Export stopped: ${details.reason}`; broadcast(); }
    });
    await win.loadURL(rendererUrl(`?job=${encodeURIComponent(id)}#export`));
    broadcast(); return id;
  });
  ipcMain.handle("exports:job", (event, id: string) => {
    const value = jobs.get(id);
    if (!value || value.win.webContents.id !== event.sender.id) throw new Error("invalid export worker");
    return { job: { ...value.job }, request: value.request };
  });
  ipcMain.handle("exports:update", (event, id: string, update: ExportJobUpdate) => {
    const value = jobs.get(id);
    if (!value || value.win.webContents.id !== event.sender.id) throw new Error("invalid export worker");
    if (exportFinished(value.job.phase)) return;
    if (update.preview === undefined) delete update.preview;
    Object.assign(value.job, update);
    broadcast();
    if (exportFinished(update.phase)) setTimeout(() => { if (!value.win.isDestroyed()) value.win.destroy(); }, 100);
    if (update.phase === "done" && Notification.isSupported()) {
      const notification = new Notification({ title: "Your Zoomcast video is ready", body: `${basename(value.job.file)} has finished exporting.` });
      value.notification = notification;
      notification.on("click", () => show(id)); notification.show();
    }
  });
  ipcMain.handle("exports:list", () => snapshot());
  ipcMain.handle("exports:show", (_event, id: string) => show(id));
  ipcMain.handle("exports:cancel", (_event, id: string) => {
    const value = jobs.get(id);
    if (value && !exportFinished(value.job.phase)) value.win.webContents.send("exports:cancelled", id);
  });
}
