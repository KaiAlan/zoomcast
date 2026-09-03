import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("zoomcast", {
  version: "0.1.0",
});
