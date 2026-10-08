import { app, nativeImage } from "electron";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import koffi from "koffi";
import { DESKTOP_BACKGROUND_FILE } from "../shared/style/desktopBackground";
import { logDiag } from "./log";
import { DEFAULT_IMAGE_PRESET } from "../shared/style/imagePresets";
import { copyBackgroundPreset } from "./backgroundImages";

/** Read the applied wallpaper; never change the user's Windows settings. */
function desktopWallpaperPath(): string {
  const capacity = 32768;
  const buffer = Buffer.alloc(capacity * 2);
  const getWallpaper = koffi.load("user32.dll").func(
    "__stdcall", "SystemParametersInfoW", "int", ["uint32", "uint32", "void *", "uint32"],
  );
  if (!getWallpaper(0x0073, capacity, buffer, 0)) return "";
  return buffer.toString("utf16le").split("\0", 1)[0] ?? "";
}

/** Best effort, before audio/capture starts. No wallpaper must never block a take. */
export function snapshotDesktopBackground(dir: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    const source = desktopWallpaperPath();
    if (!source) return false; // Windows solid-color desktops can retain an old cached image.
    // Windows' extensionless transcoded file also covers source formats nativeImage
    // cannot decode. Only consult it when Windows reports an applied image.
    const candidates = [source, join(app.getPath("appData"), "Microsoft", "Windows", "Themes", "TranscodedWallpaper")];
    for (const path of new Set(candidates)) {
      let image: Electron.NativeImage;
      try { image = nativeImage.createFromBuffer(readFileSync(path)); }
      catch { continue; }
      if (image.isEmpty()) continue;
      const png = image.toPNG();
      if (png.length === 0) continue;
      const destination = join(dir, DESKTOP_BACKGROUND_FILE);
      if (existsSync(destination)) throw new Error("This recording already has a wallpaper snapshot.");
      const temporary = join(dir, `.background-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, png, { flag: "wx" });
        renameSync(temporary, destination);
      } finally {
        rmSync(temporary, { force: true });
      }
      return true;
    }
    logDiag("background:desktop", "Applied desktop wallpaper could not be read; using a bundled image.");
  } catch (error) {
    logDiag("background:desktop", error);
  }
  return false;
}

export function prepareRecordingBackground(dir: string): void {
  if (snapshotDesktopBackground(dir)) return;
  try { copyBackgroundPreset(dir, DEFAULT_IMAGE_PRESET); }
  catch (error) { logDiag("background:default-image", error); }
}
