import { shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RecordingSummary } from "../shared/api";
import type { LibraryState } from "../shared/library/types";
import { LibraryStore } from "./libraryStore";
import { recordingsRoot } from "./recordingsRoot";
import { resolveFfmpeg } from "./ffmpeg";
import { logDiag } from "./log";

const run = promisify(execFile);
const store = () => new LibraryStore(recordingsRoot());
function dirSize(dir: string): number {
  return readdirSync(dir).reduce((total, name) => {
    try { const info = statSync(join(dir, name)); return total + (info.isFile() ? info.size : 0); }
    catch { return total; }
  }, 0);
}
export function getLibrary(): LibraryState {
  const library = store();
  const organization = library.read();
  const recordings: RecordingSummary[] = [];
  if (existsSync(library.root)) for (const name of readdirSync(library.root)) {
    try {
      const dir = library.bundleDir(name);
      let metadata: Partial<RecordingSummary> = {};
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        metadata = {
          createdAt: typeof manifest.createdAt === "string" && Number.isFinite(Date.parse(manifest.createdAt)) ? manifest.createdAt : statSync(dir).birthtime.toISOString(),
          durationMs: typeof manifest.durationMs === "number" && Number.isFinite(manifest.durationMs) ? manifest.durationMs : undefined,
          unclean: manifest.status === "unclean", hasWebcam: Boolean(manifest.webcam),
          audioTracks: Array.isArray(manifest.audio) ? manifest.audio.length : 0,
        };
      } catch { metadata = { createdAt: statSync(dir).birthtime.toISOString() }; }
      recordings.push({ ...metadata, id: name, dir, sizeBytes: dirSize(dir), folderId: organization.entries[name]?.folderId ?? null, archived: organization.entries[name]?.archived ?? false });
    } catch { /* A folder without a finished recording is not a card. */ }
  }
  recordings.sort((a,b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0) || b.id.localeCompare(a.id));
  return { folders: organization.folders, recordings };
}
export function listRecordings(): RecordingSummary[] { return getLibrary().recordings; }
export function createLibraryFolder(name: string, parentId: string | null) { return store().createFolder(name, parentId); }
export function moveLibraryRecording(id: string, folderId: string | null): void { store().move(id, folderId); }
export function archiveLibraryRecording(id: string, archived: boolean): void { store().archive(id, archived); }
export async function deleteLibraryRecording(id: string): Promise<void> {
  const library = store();
  // Validate metadata before sending anything to the Recycle Bin.
  library.read();
  const dir = library.bundleDir(id);
  await Promise.all([...thumbnails.entries()].filter(([key]) => key.startsWith(`${join(dir, "screen.mp4")}:`)).map(([, work]) => work));
  await shell.trashItem(library.bundleDir(id));
  library.forget(id);
}

const thumbnails = new Map<string, Promise<string | null>>();
let thumbnailQueue: Promise<unknown> = Promise.resolve();
/** Serialized, cached extraction avoids starting an ffmpeg process per visible card at once. */
export function libraryThumbnail(id: string): Promise<string | null> {
  const library = store();
  const dir = library.bundleDir(id);
  const input = join(dir, "screen.mp4");
  if (!existsSync(input)) return Promise.resolve(null);
  const info = statSync(input);
  const output = join(dir, ".zoomcast-preview.jpg");
  const url = () => `zc://app/@fs/${output.replace(/\\/g, "/")}?v=${info.mtimeMs}`;
  if (existsSync(output) && statSync(output).mtimeMs >= info.mtimeMs) return Promise.resolve(url());
  const key = `${input}:${info.size}:${info.mtimeMs}`;
  const pending = thumbnails.get(key);
  if (pending) return pending;
  const work = thumbnailQueue.then(async () => {
    try {
      // Revalidate after waiting: the recording could have been deleted from a card.
      library.bundleDir(id);
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      const duration = typeof manifest.durationMs === "number" && Number.isFinite(manifest.durationMs) ? manifest.durationMs : 0;
      await run(resolveFfmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-ss", String(Math.max(0, Math.min(1000, duration / 3)) / 1000), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", output], { timeout: 20000, windowsHide: true });
      return existsSync(output) ? url() : null;
    } catch (err) { logDiag("library:thumbnail", err); return null; }
    finally { thumbnails.delete(key); }
  });
  thumbnailQueue = work.catch(() => null);
  thumbnails.set(key, work);
  return work;
}
