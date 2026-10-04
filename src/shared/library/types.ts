import type { RecordingSummary } from "../api";

export type RecordingFolder = { id: string; name: string; parentId: string | null };
export type LibraryEntry = { folderId: string | null; archived: boolean };
export type LibraryMetadata = { version: 1; folders: RecordingFolder[]; entries: Record<string, LibraryEntry> };
export type LibraryState = { folders: RecordingFolder[]; recordings: RecordingSummary[] };
export type LibrarySort = "recent" | "oldest" | "name" | "duration" | "size";
export type LibraryScope = "all" | "unfiled" | "archive" | { folderId: string };
export type LibraryApi = {
  get: () => Promise<LibraryState>;
  createFolder: (name: string, parentId: string | null) => Promise<RecordingFolder>;
  move: (id: string, folderId: string | null) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  delete: (id: string) => Promise<void>;
  thumbnail: (id: string) => Promise<string | null>;
  recordInFolder: (folderId: string | null) => Promise<void>;
};
