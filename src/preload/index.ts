import { contextBridge, ipcRenderer } from "electron";
import type { ExportStartOptions, OpenedBundle, ZoomcastApi } from "../shared/api";
import type { Project } from "../shared/project/types";

const api: ZoomcastApi = {
  pickBundle: () => ipcRenderer.invoke("bundle:pick") as Promise<string | null>,
  openBundle: (dir: string) =>
    ipcRenderer.invoke("bundle:open", dir) as Promise<OpenedBundle>,
  saveProject: (dir: string, project: Project) =>
    ipcRenderer.invoke("bundle:save", dir, project) as Promise<void>,

  pickExportTarget: (suggested: string) =>
    ipcRenderer.invoke("export:pick", suggested) as Promise<string | null>,
  exportStart: (opts: ExportStartOptions) =>
    ipcRenderer.invoke("export:start", opts) as Promise<string>,
  exportFrame: (id: string, frame: Uint8Array) =>
    ipcRenderer.invoke("export:frame", id, frame) as Promise<void>,
  exportFinish: (id: string) => ipcRenderer.invoke("export:finish", id) as Promise<void>,
  exportCancel: (id: string) => ipcRenderer.invoke("export:cancel", id) as Promise<void>,
};

contextBridge.exposeInMainWorld("zoomcast", api);
