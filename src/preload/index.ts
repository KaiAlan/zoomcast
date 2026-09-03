import { contextBridge, ipcRenderer } from "electron";
import type { OpenedBundle, ZoomcastApi } from "../shared/api";
import type { Project } from "../shared/project/types";

const api: ZoomcastApi = {
  pickBundle: () => ipcRenderer.invoke("bundle:pick") as Promise<string | null>,
  openBundle: (dir: string) =>
    ipcRenderer.invoke("bundle:open", dir) as Promise<OpenedBundle>,
  saveProject: (dir: string, project: Project) =>
    ipcRenderer.invoke("bundle:save", dir, project) as Promise<void>,
};

contextBridge.exposeInMainWorld("zoomcast", api);
