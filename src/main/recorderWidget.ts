import { BrowserWindow, ipcMain, screen } from "electron";
import { randomUUID } from "node:crypto";
import type { RecorderAction, RecorderOptions, RecorderState } from "../shared/recorder";
import { recorderCuts } from "../shared/recorder";
import type { Cut } from "../shared/project/types";
import { isRecording, recordingClockBase, recordingDisplayBounds, startRecording, stopRecording } from "./capture/SessionController";
import { recorderSources } from "./capture/recordingTarget";
import { openBundle, saveProject } from "./bundleIo";
import { showRecordingBorder } from "./overlays";
import { preloadPath, rendererUrl } from "./windows";
import { logDiag } from "./log";
import { LibraryStore } from "./libraryStore";
import { recordingsRoot } from "./recordingsRoot";

let widget: BrowserWindow | null = null;
let border: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;
let openEditor: ((dir?: string) => void) | null = null;
const state: RecorderState = { phase: "idle", paused: false, cutting: false, elapsedMs: 0, countdownLeft: 0, error: null };
export const recorderIsBusy = (): boolean => state.phase !== "idle";
let cuts: Cut[] = [];
let pauseAt: number | null = null;
let cutAt: number | null = null;
let cancelled = false;
let updateControls: (() => void) | null = null;
const now = () => Math.max(0, Date.now() - recordingClockBase());
function broadcast(channel: string, value: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, value);
}
function push(): void {
  if (state.phase === "recording") {
    const t = now();
    const removed = recorderCuts([...cuts, ...(pauseAt === null ? [] : [{ id: "pending", startMs: pauseAt, endMs: t }])], t);
    state.elapsedMs = t - removed.reduce((sum, c) => sum + c.endMs - c.startMs, 0);
  }
  broadcast("recorder:state", state);
}
export function prepareRecorderFolder(folderId: string | null): void {
  if (state.phase !== "idle" || isRecording()) {
    if ((state.folderId ?? null) !== folderId) throw new Error("Finish the current recording before changing its folder");
    return;
  }
  const folder = new LibraryStore(recordingsRoot()).folder(folderId);
  state.folderId = folderId;
  state.folderName = folder?.name ?? "Library";
  push();
}
export function showRecorderWidget(): void {
  if (widget !== null && !widget.isDestroyed()) { widget.show(); widget.focus(); push(); return; }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  widget = new BrowserWindow({
    width: 430, height: 70, x: Math.round(workArea.x + (workArea.width - 430) / 2), y: workArea.y + 32,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: "#00000000", hasShadow: false, title: "zoomcast recorder",
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  widget.setContentProtection(true);
  widget.setAlwaysOnTop(true, "screen-saver");
  widget.on("closed", () => { widget = null; });
  void widget.loadURL(rendererUrl("#recorder"));
}
function endRange(start: number | null): void {
  if (start !== null) cuts.push({ id: randomUUID(), startMs: start, endMs: now() });
}
export async function recorderAction(action: RecorderAction, options?: RecorderOptions): Promise<void> {
  if (action === "hide") { if (state.phase === "countdown") cancelled = true; widget?.hide(); return; }
  if (action === "editor") { openEditor?.(); return; }
  if (action === "cancel") { if (state.phase === "countdown") cancelled = true; return; }
  if (action === "pause" && state.phase === "recording") {
    if (pauseAt === null) pauseAt = now(); else { endRange(pauseAt); pauseAt = null; }
    state.paused = pauseAt !== null; push(); return;
  }
  if (action === "cut" && state.phase === "recording") {
    if (cutAt === null) cutAt = now(); else { endRange(cutAt); cutAt = null; }
    state.cutting = cutAt !== null; push(); return;
  }
  if (action === "stop" && state.phase === "recording") {
    const pausedAtStop = pauseAt !== null;
    const cuttingAtStop = cutAt !== null;
    endRange(pauseAt); endRange(cutAt); pauseAt = cutAt = null;
    state.phase = "stopping"; push();
    try {
      const result = await stopRecording();
      // A capture can produce a final frame while ffmpeg is finishing.
      const trailing = Number(pausedAtStop) + Number(cuttingAtStop);
      for (const cut of cuts.slice(cuts.length - trailing)) cut.endMs = result.durationMs;
      if (cuts.length > 0) {
        const bundle = openBundle(result.dir);
        saveProject(result.dir, { ...bundle.project, cuts: recorderCuts(cuts, result.durationMs) });
      }
      openEditor?.(result.dir);
      broadcast("recording:stopped", result);
    } catch (err) { report(err); }
    finally {
      border?.destroy(); border = null;
      state.phase = "idle"; state.paused = state.cutting = false;
      if (timer !== null) clearInterval(timer); timer = null;
      updateControls?.(); push();
    }
    return;
  }
  if (action !== "start" || state.phase !== "idle" || isRecording()) return;
  if (!options || ![0, 3, 5, 10].includes(options.countdown) || typeof options.sourceId !== "string") throw new Error("Invalid recording options");
  state.error = null; cuts = []; pauseAt = cutAt = null; cancelled = false;
  state.elapsedMs = 0; state.phase = "countdown";
  try {
    for (let n = options.countdown; n > 0 && !cancelled; n--) {
      state.countdownLeft = n; push();
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
    if (cancelled) { state.phase = "idle"; state.countdownLeft = 0; push(); return; }
    state.phase = "starting"; state.countdownLeft = 0; push();
    await startRecording({ ...options, folderId: state.folderId ?? null });
    if (options.sourceId === "" || options.sourceId.startsWith("screen:")) {
      try { border = showRecordingBorder(recordingDisplayBounds()); }
      catch (err) { logDiag("recorder:border", err); }
    }
    state.phase = "recording";
    timer = setInterval(push, 200);
    updateControls?.(); broadcast("recording:started", true); push();
  } catch (err) { state.phase = "idle"; report(err); push(); }
}
function report(err: unknown): void {
  state.error = err instanceof Error ? err.message : String(err);
  logDiag("recorder", state.error);
  broadcast("recording:error", state.error);
}
export function registerRecorderWidget(editor: (dir?: string) => void, controls: () => void): void {
  openEditor = editor; updateControls = controls;
  ipcMain.handle("recorder:resize", (_event, height: number) => {
    if (widget && Number.isFinite(height)) {
      // Windows can retain a non-resizable window's previous minimum size.
      widget.setResizable(true);
      widget.setSize(430, Math.max(70, Math.min(390, Math.ceil(height))));
      widget.setResizable(false);
    }
  });
  ipcMain.handle("recorder:state", () => { push(); return state; });
  ipcMain.handle("recorder:sources", () => recorderSources());
  ipcMain.handle("recorder:action", (_event, action: RecorderAction, options?: RecorderOptions) => recorderAction(action, options));
}
export function destroyRecorderWidget(): void {
  cancelled = true;
  if (timer !== null) clearInterval(timer);
  widget?.destroy(); widget = null; border?.destroy(); border = null;
}
