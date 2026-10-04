import { app } from "electron";

/**
 * Run at login.
 *
 * A tray app with a global hotkey is only useful while it is running, and
 * "press Ctrl+Alt+Z any time" is a lie if you first have to find the app. So
 * the installed build can start with Windows — hidden, straight to the tray,
 * with no editor window until something is actually recorded.
 *
 * Off by default: turning it on is the user's decision, made from the tray.
 */
export const HIDDEN_FLAG = "--hidden";

export function autostartEnabled(): boolean {
  return app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin;
}

export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] });
}

/** True when Windows started us at login rather than a person opening the app. */
export function startedHidden(): boolean {
  return process.argv.includes(HIDDEN_FLAG);
}
