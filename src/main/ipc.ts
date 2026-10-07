import { registerExportJobs } from "./exportJobs";
import { openFeedback } from "./feedback";
import { IMAGE_PRESETS } from "../shared/style/imagePresets";
import { BrowserWindow, dialog, ipcMain, MessageChannelMain, nativeTheme, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { copyFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ExportStartOptions } from "../shared/api";
import { formatExportFailure, formatExportStart } from "../shared/export/diagnostics";
import type { Project } from "../shared/project/types";
import { openBundle, saveProject } from "./bundleIo";
import { loadSettings, saveSettings } from "./settingsStore";
import type { Settings } from "../shared/settings/types";
import { isRecording } from "./capture/SessionController";
import { pickEncoder } from "./ffmpeg";
import { ExportFrameStream } from "./exportFrameStream";
import { ExportSession } from "./exportRunner";
import { logDiag } from "./log";
import { listRecordings, recordHotkeyLabel, showSettings, toggleRecording } from "./recording";

import { getLibrary, createLibraryFolder, moveLibraryRecording, archiveLibraryRecording, deleteLibraryRecording, libraryThumbnail } from "./library";
import { prepareRecorderFolder, showRecorderWidget } from "./recorderWidget";

const sessions = new Map<string, { session: ExportSession; ownerId: number; frameBytes: number; stream?: ExportFrameStream }>();

function ownedExport(sender: WebContents, id: string) {
  const value = sessions.get(id);
  if (!value || value.ownerId !== sender.id) throw new Error(`no export session ${id}`);
  return value;
}

function cancelExport(id: string): void {
  const value = sessions.get(id);
  sessions.delete(id);
  value?.stream?.close();
  value?.session.cancel();
}

export function registerIpc(): void {
  ipcMain.handle("feedback:open", (_event, request: import("../shared/feedback").FeedbackRequest) => openFeedback(request));
  registerExportJobs();
  ipcMain.handle("library:get", () => getLibrary());
  ipcMain.handle("library:createFolder", (_event, name: string, parentId: string | null) => createLibraryFolder(name, parentId));
  ipcMain.handle("library:move", (_event, id: string, folderId: string | null) => moveLibraryRecording(id, folderId));
  ipcMain.handle("library:archive", (_event, id: string, archived: boolean) => archiveLibraryRecording(id, archived));
  ipcMain.handle("library:delete", (_event, id: string) => deleteLibraryRecording(id));
  ipcMain.handle("library:thumbnail", (_event, id: string) => libraryThumbnail(id));
  ipcMain.handle("library:recordInFolder", (_event, folderId: string | null) => {
    prepareRecorderFolder(folderId); showRecorderWidget();
  });
  ipcMain.handle("bundle:pick", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result =
      win === undefined
        ? await dialog.showOpenDialog({ properties: ["openDirectory"] })
        : await dialog.showOpenDialog(win, { properties: ["openDirectory"] });

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("bundle:open", (_event, dir: string) => openBundle(dir));

  ipcMain.handle("bundle:save", (_event, dir: string, project: Project) => {
    saveProject(dir, project);
  });

  ipcMain.handle("background:preset", (_event, dir: string, id: string) => {
    const preset = IMAGE_PRESETS.find(image => image.id === id);
    if (!preset) throw new Error("Unknown background preset");
    const file = `background-preset-${preset.id}.svg`;
    writeFileSync(join(dir, file), preset.svg, "utf8");
    return file;
  });
  ipcMain.handle("background:choose", async (_event, dir: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: "choose a background image",
      properties: ["openFile" as const],
      filters: [{ name: "images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    };

    const result =
      win === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(win, options);

    const src = result.canceled ? undefined : result.filePaths[0];
    if (src === undefined) return null;

    // Copied into the project, never referenced: spec §5, so a project does not
    // break when the source file is moved, renamed or deleted. Timestamped so
    // replacing the image cannot collide with a texture still cached under the
    // old name.
    const name = `background-${Date.now()}${extname(src).toLowerCase()}`;
    try {
      copyFileSync(src, join(dir, name));
    } catch (err) {
      logDiag("background:choose", err);
      return null;
    }

    return name;
  });

  ipcMain.handle("settings:open", () => showSettings());
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:set", (_event, settings: Settings) => {
    saveSettings(settings);
    const saved = loadSettings();
    nativeTheme.themeSource = saved.theme;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("settings:changed", saved);
  });

  ipcMain.handle("recording:list", () => listRecordings());
  ipcMain.handle("recording:hotkey", () => recordHotkeyLabel());
  ipcMain.handle("recording:toggle", () => toggleRecording());
  ipcMain.handle("recording:isActive", () => isRecording());

  ipcMain.handle("export:pick", async (_event, suggested: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      defaultPath: suggested,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    };

    const result =
      win === undefined
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(win, options);

    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle("export:start", async (event, requested: ExportStartOptions) => {
    const opts = { ...requested, encoder: requested.encoder === "auto" ? await pickEncoder() : requested.encoder };
    const id = randomUUID();
    logDiag("export:start", `${id} ${formatExportStart(opts)}`);
    sessions.set(id, { session: ExportSession.start(opts), ownerId: event.sender.id, frameBytes: opts.width * opts.height * 4 });
    event.sender.once("destroyed", () => cancelExport(id));
    return id;
  });

  ipcMain.handle("export:connect", (event, id: string) => {
    const value = ownedExport(event.sender, id);
    if (value.stream) throw new Error("export frame channel already connected");
    const { port1, port2 } = new MessageChannelMain();
    value.stream = new ExportFrameStream(port1, value.frameBytes, frame => value.session.write(frame), error => {
      logDiag("export:channel-closed", `${id} ${formatExportFailure(error.message, value.session.stderrTail())}`);
      cancelExport(id);
    });
    event.sender.postMessage("export:port", id, [port2]);
  });

  // Retained for diagnostic clients; product exports use the dedicated port.
  ipcMain.handle("export:frame", async (event, id: string, frame: Uint8Array) => {
    const { session, stream } = ownedExport(event.sender, id);
    if (stream) throw new Error("dedicated export frame channel already in use");
    await session.write(frame);
  });

  ipcMain.handle("export:finish", async (event, id: string) => {
    const { session, stream } = ownedExport(event.sender, id);
    try {
      await session.finish();
      logDiag("export:finish", `${id} ok`);
      logDiag("export:write-timings", JSON.stringify({ sessionId: id, ...session.writeTimings() }));
    } catch (err) {
      logDiag(
        "export:finish",
        `${id} ${formatExportFailure(String(err), session.stderrTail())}`,
      );
      throw err;
    } finally {
      sessions.delete(id);
      stream?.close();
    }
  });

  ipcMain.handle("export:cancel", (event, id: string, reason: string) => {
    const value = sessions.get(id);
    if (value && value.ownerId !== event.sender.id) throw new Error("invalid export owner");
    const session = value?.session;
    if (session !== undefined) {
      logDiag(
        "export:cancel",
        `${id} ${formatExportFailure(reason, session.stderrTail())}`,
      );
    }
    cancelExport(id);
  });
}

export function cancelAllExportSessions(): void {
  for (const id of sessions.keys()) cancelExport(id);
}
