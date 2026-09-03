import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { OpenedBundle } from "../shared/api";
import { parseManifest } from "../shared/bundle/manifest";
import { parseTelemetry } from "../shared/bundle/telemetry";
import type { TelemetryEvent } from "../shared/bundle/types";
import { defaultProject } from "../shared/project/defaults";
import type { Project } from "../shared/project/types";

const PROJECT_FILE = "project.json";

/** Absolute disk path to a URL the renderer is allowed to fetch. */
function mediaUrl(dir: string, file: string): string {
  return `zc://app/@fs/${join(dir, file).replace(/\\/g, "/")}`;
}

/**
 * The only place that reads a bundle off disk. `src/shared/` stays pure, so
 * every parse it does is handed plain strings from here.
 */
export function openBundle(dir: string): OpenedBundle {
  const root = resolve(dir);

  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`no manifest.json in ${root}`);
  }

  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));

  let telemetry: TelemetryEvent[] = [];
  const telemetryFile = manifest.telemetry?.file;
  if (telemetryFile !== undefined) {
    const telemetryPath = join(root, telemetryFile);
    if (existsSync(telemetryPath)) {
      telemetry = parseTelemetry(readFileSync(telemetryPath, "utf8"));
    }
  }

  const projectPath = join(root, PROJECT_FILE);
  const project: Project = existsSync(projectPath)
    ? (JSON.parse(readFileSync(projectPath, "utf8")) as Project)
    : defaultProject(manifest.id);

  return {
    dir: root,
    manifest,
    telemetry,
    project,
    media: {
      screen: mediaUrl(root, manifest.video.file),
      webcam:
        manifest.webcam === undefined
          ? undefined
          : mediaUrl(root, manifest.webcam.file),
    },
  };
}

export function saveProject(dir: string, project: Project): void {
  writeFileSync(
    join(resolve(dir), PROJECT_FILE),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8",
  );
}
