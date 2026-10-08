import { app, globalShortcut, shell } from "electron";
import { readFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { logDiag } from "./log";
import { windowsShortcutHotkey } from "./windowsShortcut";

export const RECORD_HOTKEY = "CommandOrControl+Alt+R";
let hotkey = "";
let mode: "launcher" | "global" | "conflict" = "conflict";

/** Only trust an installer-created link targeting this exact executable. */
function installedLauncher(): string | null {
  if (!app.isPackaged || process.platform !== "win32") return null;
  try {
    const [link, label] = readFileSync(join(dirname(process.execPath), "record-shortcut.path"), "utf16le").replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!link || !label || !/^Ctrl\+Alt\+(?:[A-Z]|F(?:[1-9]|1\d|2[0-4]))$/.test(label)) return null;
    const details = shell.readShortcutLink(link);
    if (win32.normalize(details.target).toLowerCase() !== win32.normalize(process.execPath).toLowerCase() || details.args !== "--record") return null;
    return windowsShortcutHotkey(readFileSync(link));
  } catch (error) {
    logDiag("hotkey:launcher-unavailable", error);
    return null;
  }
}

export function registerRecordShortcut(openRecorder: () => void): void {
  const launcher = installedLauncher();
  if (launcher !== null) {
    hotkey = launcher;
    mode = "launcher";
    // Windows can activate an existing window instead of launching a second
    // process. Route that activation to the recorder even if its window is hidden.
    // https://learn.microsoft.com/en-us/cpp/mfc/global-hot-keys
    app.on("browser-window-created", (_event, win) => {
      win.hookWindowMessage(0x0112, wParam => {
        if (wParam.length >= 4 && (wParam.readUInt32LE(0) & 0xfff0) === 0xf150) {
          setImmediate(openRecorder);
        }
      });
    });
    logDiag("hotkey", `Windows launcher ${hotkey}`);
    return;
  }
  const registered = globalShortcut.register(RECORD_HOTKEY, openRecorder);
  mode = registered ? "global" : "conflict";
  hotkey = registered ? RECORD_HOTKEY.replace("CommandOrControl", process.platform === "darwin" ? "Cmd" : "Ctrl") : "";
  logDiag("hotkey", registered ? `registered ${hotkey}` : "Ctrl+Alt+R is occupied. Open recording controls from the tray; no alternate shortcut was assigned.");
}

export function recordShortcutInfo(): { hotkey: string; mode: typeof mode } {
  return { hotkey, mode };
}
