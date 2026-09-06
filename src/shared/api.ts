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
  media: BundleMedia;
};

export type RecordingSummary = {
  id: string;
  dir: string;
  sizeBytes: number;
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
  chooseBackgroundImage: (dir: string) => Promise<string | null>;

  /** Used only by the hidden audio-capture renderer. */
  audioChunk: (role: "mic" | "system", chunk: Uint8Array) => Promise<void>;

  listRecordings: () => Promise<RecordingSummary[]>;
  /** Display label for the global record shortcut, so the UI cannot drift. */
  recordHotkey: () => Promise<string>;
  toggleRecording: () => Promise<void>;
  isRecording: () => Promise<boolean>;
  recording: RecordingEvents;

  /** App-level settings. Separate from Project, which lives inside a bundle. */
  getSettings: () => Promise<Settings>;
  setSettings: (settings: Settings) => Promise<void>;

  pickExportTarget: (suggested: string) => Promise<string | null>;
  /** Starts ffmpeg and returns a session id to push frames into. */
  exportStart: (opts: ExportStartOptions) => Promise<string>;
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
