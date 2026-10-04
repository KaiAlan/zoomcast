import type { RecordingSummary } from "../api";
import type { LibraryScope, LibrarySort, RecordingFolder } from "./types";

export function recordingLabel(r: RecordingSummary): string {
  return r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : r.id;
}

export function folderPath(folders: RecordingFolder[], id: string): RecordingFolder[] {
  const path: RecordingFolder[] = [];
  const visited = new Set<string>();
  let next: string | null = id;
  while (next !== null && !visited.has(next)) {
    visited.add(next);
    const folder = folders.find(f => f.id === next);
    if (!folder) break;
    path.unshift(folder);
    next = folder.parentId;
  }
  return path;
}
export function visibleRecordings(recordings: RecordingSummary[], scope: LibraryScope, query: string, sort: LibrarySort): RecordingSummary[] {
  const text = query.trim().toLocaleLowerCase();
  const date = (r: RecordingSummary) => Date.parse(r.createdAt ?? "") || 0;
  const compare = (a: RecordingSummary, b: RecordingSummary): number => {
    switch (sort) {
      case "oldest": return date(a) - date(b);
      case "name": return a.id.localeCompare(b.id, undefined, { numeric: true });
      case "duration": return (b.durationMs ?? 0) - (a.durationMs ?? 0);
      case "size": return b.sizeBytes - a.sizeBytes;
      default: return date(b) - date(a);
    }
  };
  return recordings.filter(r => {
    if (scope === "archive" ? !r.archived : r.archived) return false;
    if (scope === "unfiled" && r.folderId != null) return false;
    if (typeof scope === "object" && r.folderId !== scope.folderId) return false;
    return `${r.id} ${r.createdAt ?? ""} ${recordingLabel(r)}`.toLocaleLowerCase().includes(text);
  }).sort((a, b) => compare(a, b) || b.id.localeCompare(a.id));
}
