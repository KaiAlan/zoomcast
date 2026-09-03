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

/**
 * The entire surface the renderer gets. Deliberately small: the renderer never
 * touches the filesystem, and `src/shared/` stays pure.
 */
export type ZoomcastApi = {
  pickBundle: () => Promise<string | null>;
  openBundle: (dir: string) => Promise<OpenedBundle>;
  saveProject: (dir: string, project: Project) => Promise<void>;
};
