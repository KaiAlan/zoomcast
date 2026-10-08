import { app, globalShortcut, Menu, nativeImage, Tray } from "electron";
import {
  isRecording,
} from "./capture/SessionController";
import { autostartEnabled, setAutostart } from "./autostart";
import { logDiag } from "./log";
import { destroyRecorderWidget, registerRecorderWidget, showRecorderWidget } from "./recorderWidget";
import { recordShortcutInfo, registerRecordShortcut } from "./recordShortcut";
import type { ShortcutState } from "../shared/shortcut";

export function recordHotkeyLabel(): string {
  return recordShortcutInfo().hotkey;
}

export function shortcutState(): ShortcutState {
  return { ...recordShortcutInfo(), startWithWindows: autostartEnabled(), startupSupported: app.isPackaged && process.platform === "win32" };
}

export function changeAutostart(enabled: boolean): ShortcutState {
  if (typeof enabled !== "boolean") throw new Error("Start with Windows must be a boolean");
  if (!app.isPackaged || process.platform !== "win32") throw new Error("Start with Windows requires the installed Windows app");
  setAutostart(enabled);
  updateTray();
  return shortcutState();
}

let tray: Tray | null = null;

/**
 * How the tray opens the editor. Owned by index.ts, because launching at login
 * — and closing the editor — both leave the app running with no window at all,
 * and the tray still has to be able to bring one back.
 */
let openEditor: ((dir?: string) => void) | null = null;

export function registerEditorOpener(open: (dir?: string) => void): void {
  openEditor = open;
}

/** Same indirection as the editor opener, for the same reason. */
let openSettings: (() => void) | null = null;

export function showSettings(): void { openSettings?.(); }

export function registerSettingsOpener(open: () => void): void {
  openSettings = open;
}

export { listRecordings } from "./library";

export async function toggleRecording(): Promise<void> {
  showRecorderWidget();
}

function updateTray(): void {
  if (tray === null) return;

  const recording = isRecording();
  tray.setToolTip(recording ? "zoomcast — recording" : "zoomcast");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: recording ? "Recording controls…" : "Record…",
        accelerator: recordHotkeyLabel() || undefined,
        registerAccelerator: false,
        click: () => void toggleRecording(),
      },
      { type: "separator" },
      {
        label: "Show editor",
        click: () => openEditor?.(),
      },
      {
        label: "Settings…",
        click: () => openSettings?.(),
      },
      { type: "separator" },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: autostartEnabled(),
        enabled: app.isPackaged && process.platform === "win32",
        click: (item) => {
          changeAutostart(item.checked);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        // One quit path. `before-quit` in index.ts finishes any take and then
        // calls app.exit; destroying the windows here without quitting left
        // the process, the tray and the hotkey alive after "Quit".
        click: () => app.quit(),
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
  registerRecorderWidget((dir) => openEditor?.(dir), updateTray);
  // A tray failure must not take the app down with it — recording still works
  // from the window and the global hotkey.
  try {
    tray = new Tray(trayIcon());
    updateTray();
  } catch (err) {
    logDiag("tray", err);
    tray = null;
  }

  registerRecordShortcut(() => void toggleRecording());

  updateTray();
}

export function teardownRecordingControls(): void {
  globalShortcut.unregisterAll();
  destroyRecorderWidget();
  tray?.destroy();
  tray = null;
}
