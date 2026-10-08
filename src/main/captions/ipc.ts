import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CaptionService } from "./service";
import { openBundle } from "../bundleIo";
import { normalizeProject } from "../../shared/project/migrate";
import { outputCaptions, subtitles } from "../../shared/captions/timing";

let service: CaptionService | undefined;
function captions(): CaptionService {
  service ??= new CaptionService(join(app.getPath("userData"), "speech"), state => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("captions:changed", state);
  });
  return service;
}
export function captionsAreBusy(): boolean { return service?.state().busy ?? false; }
export function cancelCaptionTasks(): void { service?.cancel(); }

function assertWindow(event: IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame || !BrowserWindow.fromWebContents(event.sender)) throw new Error("Caption tasks require an application window.");
}

/** Closing the requesting window terminates its work and removes partial downloads. */
async function owned<T>(event: IpcMainInvokeEvent, operation: () => Promise<T>): Promise<T> {
  assertWindow(event);
  if (captionsAreBusy()) throw new Error("Another caption task is running. Wait for it or cancel it first.");
  const cancel = () => captions().cancel();
  event.sender.once("destroyed", cancel);
  try { return await operation(); } finally { event.sender.removeListener("destroyed", cancel); }
}

const requestSchema = z.object({ dir: z.string().min(1).max(4096), source: z.enum(["mic", "system", "mix"]), language: z.string().regex(/^[a-z]{2,3}$|^auto$/) });

export function registerCaptionIpc(): void {
  ipcMain.handle("captions:state", event => { assertWindow(event); return captions().state(); });
  ipcMain.handle("captions:install", event => owned(event, () => captions().install()));
  ipcMain.handle("captions:remove", event => { assertWindow(event); return captions().remove(); });
  ipcMain.handle("captions:cancel", event => { assertWindow(event); captions().cancel(); });
  ipcMain.handle("captions:generate", (event, raw: unknown) => {
    const request = requestSchema.parse(raw);
    return owned(event, () => captions().generate(request.dir, request.source, request.language));
  });
  ipcMain.handle("captions:export", async (event, raw: unknown) => {
    assertWindow(event);
    const request = z.object({ dir: z.string().min(1).max(4096), format: z.enum(["srt", "vtt"]), project: z.object({ bundleId: z.string() }).passthrough() }).parse(raw);
    const bundle = openBundle(request.dir);
    if (request.project.bundleId !== bundle.manifest.id) throw new Error("The captions belong to a different recording.");
    const project = normalizeProject(request.project, bundle.manifest.id);
    const cues = outputCaptions(project, bundle.manifest.durationMs);
    if (!cues.length) throw new Error("There are no captions in the kept clips to export.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("The editor window was closed.");
    const result = await dialog.showSaveDialog(window, { title: "Export subtitles", defaultPath: join(bundle.dir, `captions.${request.format}`), filters: [{ name: `${request.format.toUpperCase()} subtitles`, extensions: [request.format] }] });
    if (result.canceled || !result.filePath) return false;
    const target = result.filePath.toLowerCase().endsWith(`.${request.format}`) ? result.filePath : `${result.filePath}.${request.format}`;
    if (["manifest.json", "project.json", ...bundle.manifest.audio.map(a => a.file), bundle.manifest.video.file].some(f => resolve(bundle.dir, f).toLowerCase() === resolve(target).toLowerCase())) throw new Error("Choose a separate subtitle file.");
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, subtitles(cues, request.format), { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
    return true;
  });
}
