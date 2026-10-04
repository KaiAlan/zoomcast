import { app } from "electron";
import { join } from "node:path";

export function recordingsRoot(): string {
  const local = process.env.LOCALAPPDATA;
  return local === undefined ? join(app.getPath("userData"), "recordings") : join(local, "zoomcast", "recordings");
}
