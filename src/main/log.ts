import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Electron's main-process stdout does not reach the launching shell on Windows,
 * so anything worth diagnosing goes to a file. Several capture failures looked
 * like silent crashes purely because console.error went nowhere.
 */
export function diagFile(): string {
  return join(app.getPath("userData"), "main-error.log");
}

export function logDiag(where: string, detail: unknown): void {
  const message =
    detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);

  try {
    const file = diagFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `[${new Date().toISOString()}] ${where}: ${message}\n`, "utf8");
  } catch {
    // Nothing sensible left to do.
  }

  console.error(where, message);
}
