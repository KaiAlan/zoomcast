import { BrowserWindow, globalShortcut, Menu, nativeImage, Tray } from "electron";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RecordingSummary } from "../shared/api";
import {
  abortRecording,
  isRecording,
  recordingsRoot,
  startRecording,
  stopRecording,
} from "./capture/SessionController";
import { logDiag } from "./log";
import { runCountdown, showRecordingBorder } from "./overlays";

export const RECORD_HOTKEY = "CommandOrControl+Shift+R";

let tray: Tray | null = null;
let border: BrowserWindow | null = null;
let busy = false;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    try {
      total += statSync(join(dir, name)).size;
    } catch {
      // A file vanished mid-scan; it simply does not count.
    }
  }
  return total;
}

/** Newest first. Only directories that actually contain a manifest. */
export function listRecordings(): RecordingSummary[] {
  const root = recordingsRoot();
  if (!existsSync(root)) return [];

  const out: RecordingSummary[] = [];

  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, "manifest.json"))) continue;
      out.push({ id: name, dir, sizeBytes: dirSizeBytes(dir) });
    } catch {
      // Unreadable entry; skip it rather than failing the whole listing.
    }
  }

  return out.sort((a, b) => b.id.localeCompare(a.id));
}

export async function toggleRecording(): Promise<void> {
  if (busy) return;
  busy = true;

  try {
    if (isRecording()) {
      const result = await stopRecording();

      border?.destroy();
      border = null;
      updateTray();

      broadcast("recording:stopped", result);
      return;
    }

    broadcast("recording:countdown", true);
    await runCountdown();

    await startRecording();
    border = showRecordingBorder();
    updateTray();

    broadcast("recording:started", true);
  } catch (err) {
    border?.destroy();
    border = null;
    updateTray();
    const message = err instanceof Error ? err.message : String(err);
    logDiag("recording", message);
    broadcast("recording:error", message);
  } finally {
    busy = false;
  }
}

function updateTray(): void {
  if (tray === null) return;

  const recording = isRecording();
  tray.setToolTip(recording ? "zoomcast — recording" : "zoomcast");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: recording ? "Stop recording" : "Start recording",
        accelerator: RECORD_HOTKEY,
        click: () => void toggleRecording(),
      },
      { type: "separator" },
      {
        label: "Show editor",
        click: () => BrowserWindow.getAllWindows()[0]?.show(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          void abortRecording().finally(() => {
            for (const win of BrowserWindow.getAllWindows()) win.destroy();
          });
        },
      },
    ]),
  );
}

/**
 * A 16x16 dot drawn at runtime. Windows rejects an empty/1x1 tray image, and
 * shipping an .ico only to have it look wrong at every DPI is not worth it yet.
 */
function trayIcon(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - (size - 1) / 2;
      const dy = y - (size - 1) / 2;
      const inside = Math.hypot(dx, dy) <= size / 2 - 2;
      const i = (y * size + x) * 4;
      // BGRA
      buf[i] = 230;
      buf[i + 1] = 230;
      buf[i + 2] = 230;
      buf[i + 3] = inside ? 255 : 0;
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

export function registerRecordingControls(): void {
  // A tray failure must not take the app down with it — recording still works
  // from the window and the global hotkey.
  try {
    tray = new Tray(trayIcon());
    updateTray();
  } catch (err) {
    logDiag("tray", err);
    tray = null;
  }

  if (!globalShortcut.register(RECORD_HOTKEY, () => void toggleRecording())) {
    console.warn(`could not register ${RECORD_HOTKEY}; another app likely owns it`);
  }
}

export function teardownRecordingControls(): void {
  globalShortcut.unregisterAll();
  border?.destroy();
  border = null;
  tray?.destroy();
  tray = null;
}
