import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const file = (): string => join(app.getPath("userData"), "update-access.bin");
export const canStoreUpdateAccess = (): boolean => process.platform === "win32" && safeStorage.isEncryptionAvailable();
export function readUpdateAccess(): string | null {
  if (!canStoreUpdateAccess() || !existsSync(file())) return null;
  try { return safeStorage.decryptString(readFileSync(file())); }
  catch { return null; }
}
export function storeUpdateAccess(token: string | null): void {
  if (token === null) { rmSync(file(), { force: true }); return; }
  if (!canStoreUpdateAccess()) throw new Error("Windows credential protection is unavailable.");
  const target = file();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.new`, safeStorage.encryptString(token));
  renameSync(`${target}.new`, target);
}
