import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSettings } from "../shared/settings/migrate";
import type { Settings } from "../shared/settings/types";
import { logDiag } from "./log";

function file(): string {
  return join(app.getPath("userData"), "settings.json");
}

/**
 * Read on demand rather than cached at startup.
 *
 * Recording reads this once per take, so a change made in the settings window
 * applies to the next recording with no invalidation to get wrong. The file is
 * tiny and this is nowhere near a per-frame path.
 */
export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    // Missing on first run, unreadable or truncated after a bad write. All of
    // them mean "use the defaults", and none is worth a dialog.
    return normalizeSettings(null);
  }
}

export function saveSettings(s: Settings): void {
  try {
    writeFileSync(file(), `${JSON.stringify(normalizeSettings(s), null, 2)}\n`, "utf8");
  } catch (err) {
    // Worth knowing about: the UI would show the new value while the next
    // recording silently used the old one.
    logDiag("settings:save", err);
  }
}
