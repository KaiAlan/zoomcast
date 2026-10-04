import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { LibraryMetadata, RecordingFolder } from "../shared/library/types";

/** Media stays at its original path; only organization metadata is changed. */
export class LibraryStore {
  constructor(readonly root: string) {}
  private file(): string { return join(this.root, ".library.json"); }
  read(): LibraryMetadata {
    if (!existsSync(this.file())) return { version: 1, folders: [], entries: Object.create(null) as LibraryMetadata["entries"] };
    const raw = JSON.parse(readFileSync(this.file(), "utf8")) as LibraryMetadata;
    if (raw.version !== 1 || !Array.isArray(raw.folders) || !raw.entries || typeof raw.entries !== "object" || Array.isArray(raw.entries)) throw new Error("Library organization data is damaged. Restore .library.json before making changes.");
    const seen = new Set<string>();
    for (const f of raw.folders) {
      if (!f || typeof f.id !== "string" || typeof f.name !== "string" || (f.parentId !== null && typeof f.parentId !== "string") || seen.has(f.id)) throw new Error("Invalid library folder data");
      seen.add(f.id);
    }
    for (const f of raw.folders) {
      const chain = new Set([f.id]);
      let id = f.parentId;
      while (id !== null) {
        if (chain.has(id)) throw new Error("Library folders contain a cycle");
        chain.add(id);
        const parent = raw.folders.find(p => p.id === id);
        if (!parent) throw new Error("Library folder parent is missing");
        id = parent.parentId;
      }
    }
    for (const e of Object.values(raw.entries)) {
      if (!e || typeof e.archived !== "boolean" || (e.folderId !== null && !seen.has(e.folderId))) throw new Error("Invalid recording organization data");
    }
    return { ...raw, entries: Object.assign(Object.create(null), raw.entries) };
  }
  private write(data: LibraryMetadata): void {
    mkdirSync(this.root, { recursive: true });
    const temporary = `${this.file()}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(temporary, this.file());
  }
  folder(id: string | null, data = this.read()): RecordingFolder | null {
    if (id === null) return null;
    const folder = data.folders.find(f => f.id === id);
    if (!folder) throw new Error("That folder no longer exists");
    return folder;
  }
  bundleDir(id: string): string {
    if (typeof id !== "string" || !id || (/[\\/]/.test(id) || id.includes(String.fromCharCode(0))) || id === "." || id === "..") throw new Error("Invalid recording id");
    const dir = join(this.root, id);
    if (!existsSync(join(dir, "manifest.json")) || lstatSync(dir).isSymbolicLink() || relative(realpathSync(this.root), realpathSync(dir)) !== id) throw new Error("Recording is unavailable or outside the library");
    return dir;
  }
  createFolder(name: string, parentId: string | null): RecordingFolder {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80 || (/[\\/]/.test(name) || [...name].some(c => c.charCodeAt(0) < 32))) throw new Error("Enter a folder name of 1–80 characters without slashes");
    const data = this.read();
    this.folder(parentId, data);
    const clean = name.trim();
    if (data.folders.some(f => f.parentId === parentId && f.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("A folder with that name already exists here");
    const folder: RecordingFolder = { id: randomUUID(), name: clean, parentId };
    data.folders.push(folder); this.write(data); return folder;
  }
  move(id: string, folderId: string | null): void {
    this.bundleDir(id);
    const data = this.read(); this.folder(folderId, data);
    data.entries[id] = { folderId, archived: data.entries[id]?.archived ?? false };
    this.write(data);
  }
  archive(id: string, archived: boolean): void {
    if (typeof archived !== "boolean") throw new Error("Invalid archive state");
    this.bundleDir(id);
    const data = this.read();
    data.entries[id] = { folderId: data.entries[id]?.folderId ?? null, archived };
    this.write(data);
  }
  forget(id: string): void {
    const data = this.read(); delete data.entries[id]; this.write(data);
  }
}
