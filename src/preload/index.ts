import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ExportStartOptions,
  OpenedBundle,
  RecordingResult,
  RecordingSummary,
  ZoomcastApi,
} from "../shared/api";
import type { Project } from "../shared/project/types";
import type { Settings } from "../shared/settings/types";

/** Subscribe to a main-process push, returning an unsubscribe function. */
function on<T>(channel: string, fn: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Pass this dedicated channel straight into the page's main world. Routing
// frame arrays through contextBridge would clone every 8MB frame again.
ipcRenderer.on("export:port", (event, id: string) => {
  window.postMessage({ type: "zoomcast:export-port", id }, "*", event.ports);
});

const saveBeforeUpdate = new Set<() => Promise<void>>();
ipcRenderer.on("updates:prepare", (_event, token: string) => {
  void Promise.all([...saveBeforeUpdate].map(save => Promise.resolve().then(save))).then(
    () => ipcRenderer.send("updates:saved", token),
    () => ipcRenderer.send("updates:saved", token, "Could not save an open project"),
  );
});

const api: ZoomcastApi = {
  updates: {
    state: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onChanged: callback => on("updates:changed", callback),
    onBeforeInstall: save => { saveBeforeUpdate.add(save); return () => { saveBeforeUpdate.delete(save); }; },
  },
  exports: {
    start: request => ipcRenderer.invoke("exports:start", request),
    job: id => ipcRenderer.invoke("exports:job", id),
    update: (id, update) => ipcRenderer.invoke("exports:update", id, update),
    list: () => ipcRenderer.invoke("exports:list"),
    show: id => ipcRenderer.invoke("exports:show", id),
    cancel: id => ipcRenderer.invoke("exports:cancel", id),
    onOpen: callback => on("exports:open", callback),
    onCancelled: callback => on("exports:cancelled", callback),
    onChanged: callback => on("exports:changed", callback),
  },
  library: {
    get: () => ipcRenderer.invoke("library:get"),
    createFolder: (name, parentId) => ipcRenderer.invoke("library:createFolder", name, parentId),
    move: (id, folderId) => ipcRenderer.invoke("library:move", id, folderId),
    archive: (id, archived) => ipcRenderer.invoke("library:archive", id, archived),
    delete: (id) => ipcRenderer.invoke("library:delete", id),
    thumbnail: (id) => ipcRenderer.invoke("library:thumbnail", id),
    recordInFolder: (folderId) => ipcRenderer.invoke("library:recordInFolder", folderId),
  },
  recorder: {
    resize: (height) => ipcRenderer.invoke("recorder:resize", height),
    state: () => ipcRenderer.invoke("recorder:state"),
    sources: () => ipcRenderer.invoke("recorder:sources"),
    action: (action, options) => ipcRenderer.invoke("recorder:action", action, options),
    onState: (fn) => on("recorder:state", fn),
  },
  pickBundle: () => ipcRenderer.invoke("bundle:pick") as Promise<string | null>,
  openBundle: (dir: string) =>
    ipcRenderer.invoke("bundle:open", dir) as Promise<OpenedBundle>,
  saveProject: (dir: string, project: Project) =>
    ipcRenderer.invoke("bundle:save", dir, project) as Promise<void>,

  chooseBackgroundPreset: (dir: string, id: string) => ipcRenderer.invoke("background:preset", dir, id) as Promise<string>,
  chooseBackgroundImage: (dir: string) =>
    ipcRenderer.invoke("background:choose", dir) as Promise<string | null>,

  audioChunk: (role: "mic" | "system", chunk: Uint8Array) =>
    ipcRenderer.invoke("audio:chunk", role, chunk) as Promise<void>,
  webcamChunk: (chunk: Uint8Array) => ipcRenderer.invoke("webcam:chunk", chunk) as Promise<void>,

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

  openSettings: () => ipcRenderer.invoke("settings:open") as Promise<void>,
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<Settings>,
  onSettingsChanged: (fn: (settings: Settings) => void) => on("settings:changed", fn),
  setSettings: (settings: Settings) =>
    ipcRenderer.invoke("settings:set", settings) as Promise<void>,

  pickExportTarget: (suggested: string) =>
    ipcRenderer.invoke("export:pick", suggested) as Promise<string | null>,
  exportStart: (opts: ExportStartOptions) =>
    ipcRenderer.invoke("export:start", opts) as Promise<string>,
  exportConnect: (id: string) => ipcRenderer.invoke("export:connect", id) as Promise<void>,
  exportFrame: (id: string, frame: Uint8Array) =>
    ipcRenderer.invoke("export:frame", id, frame) as Promise<void>,
  exportFinish: (id: string) => ipcRenderer.invoke("export:finish", id) as Promise<void>,
  exportCancel: (id: string, reason: string) =>
    ipcRenderer.invoke("export:cancel", id, reason) as Promise<void>,
};

contextBridge.exposeInMainWorld("zoomcast", api);
