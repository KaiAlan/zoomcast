import type { ExportJob, ExportJobUpdate, ExportRequest } from "./export/jobs";
import type { ExportArgsOptions } from "./export/ffmpegArgs";
import type { Manifest } from "./bundle/manifest";
import type { TelemetryEvent } from "./bundle/types";
import type { Project } from "./project/types";
import type { Settings } from "./settings/types";

/** Media served over the private zc:// scheme, ready to hand to fetch(). */
export type BundleMedia = {
  screen: string;
  webcam?: string;
};

export type OpenedBundle = {
  dir: string;
  manifest: Manifest;
  telemetry: TelemetryEvent[];
  project: Project;
  /** Saved segments (including an empty list) are user-owned on reopening. */
  hasSavedPlan: boolean;
  media: BundleMedia;
};

export type RecordingSummary = {
  id: string;
  dir: string;
  sizeBytes: number;
  durationMs?: number;
  unclean?: boolean;
  hasWebcam?: boolean;
  audioTracks?: number;
  createdAt?: string;
  folderId?: string | null;
  archived?: boolean;
};

export type RecordingResult = {
  dir: string;
  backend: "ddagrab" | "gdigrab";
  durationMs: number;
  unclean: boolean;
};

/** Push events the main process sends while recording. */
export type RecordingEvents = {
  onCountdown: (fn: () => void) => () => void;
  onStarted: (fn: () => void) => () => void;
  onStopped: (fn: (result: RecordingResult) => void) => () => void;
  onError: (fn: (message: string) => void) => () => void;
};

export type ExportStartOptions = Omit<ExportArgsOptions, "outFile"> & {
  outFile: string;
};

/**
 * The entire surface the renderer gets. Deliberately small: the renderer never
 * touches the filesystem, and `src/shared/` stays pure.
 */
export type ZoomcastApi = {
  openFeedback: (request: import("./feedback").FeedbackRequest) => Promise<{ copied: boolean }>;
  updates: import("./updates").UpdateApi;
  captions: import("./captions/types").CaptionApi;
  exports: {
    start: (request: ExportRequest) => Promise<string>;
    job: (id: string) => Promise<{ job: ExportJob; request: ExportRequest }>;
    update: (id: string, update: ExportJobUpdate) => Promise<void>;
    list: () => Promise<ExportJob[]>;
    show: (id: string) => Promise<void>;
    cancel: (id: string) => Promise<void>;
    onOpen: (callback: (id: string) => void) => () => void;
    onCancelled: (callback: (id: string) => void) => () => void;
    onChanged: (callback: (jobs: ExportJob[]) => void) => () => void;
  };
  recorder: import("./recorder").RecorderApi;
  library: import("./library/types").LibraryApi;
  pickBundle: () => Promise<string | null>;
  openBundle: (dir: string) => Promise<OpenedBundle>;
  saveProject: (dir: string, project: Project) => Promise<void>;

  /**
   * Pick a background image and copy it into the project directory.
   *
   * Returns the BASENAME written, not the source path — the file is copied so
   * the project does not break when the original moves. Null if cancelled, or
   * if the copy failed (which is logged main-side).
   */
  chooseBackgroundPreset: (dir: string, id: string) => Promise<string>;
  chooseBackgroundImage: (dir: string) => Promise<string | null>;

  /** Used only by the hidden audio-capture renderer. */
  audioChunk: (role: "mic" | "system", chunk: Uint8Array) => Promise<void>;
  webcamChunk: (chunk: Uint8Array) => Promise<void>;

  listRecordings: () => Promise<RecordingSummary[]>;
  /** Display label for the global record shortcut, so the UI cannot drift. */
  recordHotkey: () => Promise<string>;
  shortcutState: () => Promise<import("./shortcut").ShortcutState>;
  setStartWithWindows: (enabled: boolean) => Promise<import("./shortcut").ShortcutState>;
  toggleRecording: () => Promise<void>;
  isRecording: () => Promise<boolean>;
  recording: RecordingEvents;

  /** App-level settings. Separate from Project, which lives inside a bundle. */
  openSettings: () => Promise<void>;
  getSettings: () => Promise<Settings>;
  onSettingsChanged: (fn: (settings: Settings) => void) => () => void;
  setSettings: (settings: Settings) => Promise<void>;

  pickExportTarget: (suggested: string) => Promise<string | null>;
  /** Starts ffmpeg and returns a session id to push frames into. */
  exportStart: (opts: ExportStartOptions) => Promise<string>;
  /** Requests a dedicated frame channel, delivered by preload to the main world. */
  exportConnect: (id: string) => Promise<void>;
  /** Resolves once ffmpeg has taken the frame — this is the backpressure. */
  exportFrame: (id: string, frame: Uint8Array) => Promise<void>;
  exportFinish: (id: string) => Promise<void>;
  /**
   * Abandon an export. `reason` is required rather than optional because
   * cancel is the only path that leaves a truncated file, and it used to leave
   * no trace of why anywhere.
   */
  exportCancel: (id: string, reason: string) => Promise<void>;
};
