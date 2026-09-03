import type { ExportArgsOptions } from "./export/ffmpegArgs";
import type { Manifest } from "./bundle/manifest";
import type { TelemetryEvent } from "./bundle/types";
import type { Project } from "./project/types";

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

  pickExportTarget: (suggested: string) => Promise<string | null>;
  /** Starts ffmpeg and returns a session id to push frames into. */
  exportStart: (opts: ExportStartOptions) => Promise<string>;
  /** Resolves once ffmpeg has taken the frame — this is the backpressure. */
  exportFrame: (id: string, frame: Uint8Array) => Promise<void>;
  exportFinish: (id: string) => Promise<void>;
  exportCancel: (id: string) => Promise<void>;
};
