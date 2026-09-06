import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ExportStartOptions,
  OpenedBundle,
  RecordingResult,
  RecordingSummary,
  ZoomcastApi,
} from "../shared/api";
import type { Project } from "../shared/project/types";

/** Subscribe to a main-process push, returning an unsubscribe function. */
function on<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: ZoomcastApi = {
  pickBundle: () => ipcRenderer.invoke("bundle:pick") as Promise<string | null>,
  openBundle: (dir: string) =>
    ipcRenderer.invoke("bundle:open", dir) as Promise<OpenedBundle>,
  saveProject: (dir: string, project: Project) =>
    ipcRenderer.invoke("bundle:save", dir, project) as Promise<void>,

  chooseBackgroundImage: (dir: string) =>
    ipcRenderer.invoke("background:choose", dir) as Promise<string | null>,

  audioChunk: (role: "mic" | "system", chunk: Uint8Array) =>
    ipcRenderer.invoke("audio:chunk", role, chunk) as Promise<void>,

  listRecordings: () =>
    ipcRenderer.invoke("recording:list") as Promise<RecordingSummary[]>,
  recordHotkey: () => ipcRenderer.invoke("recording:hotkey") as Promise<string>,
  toggleRecording: () => ipcRenderer.invoke("recording:toggle") as Promise<void>,
  isRecording: () => ipcRenderer.invoke("recording:isActive") as Promise<boolean>,
  recording: {
    onCountdown: (fn) => on("recording:countdown", fn),
    onStarted: (fn) => on("recording:started", fn),
    onStopped: (fn) => on<RecordingResult>("recording:stopped", fn),
    onError: (fn) => on<string>("recording:error", fn),
  },

  pickExportTarget: (suggested: string) =>
    ipcRenderer.invoke("export:pick", suggested) as Promise<string | null>,
  exportStart: (opts: ExportStartOptions) =>
    ipcRenderer.invoke("export:start", opts) as Promise<string>,
  exportFrame: (id: string, frame: Uint8Array) =>
    ipcRenderer.invoke("export:frame", id, frame) as Promise<void>,
  exportFinish: (id: string) => ipcRenderer.invoke("export:finish", id) as Promise<void>,
  exportCancel: (id: string, reason: string) =>
    ipcRenderer.invoke("export:cancel", id, reason) as Promise<void>,
};

contextBridge.exposeInMainWorld("zoomcast", api);
