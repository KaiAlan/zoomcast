import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { OpenedBundle } from "../shared/api";
import { parseManifest } from "../shared/bundle/manifest";
import { parseTelemetry } from "../shared/bundle/telemetry";
import type { TelemetryEvent } from "../shared/bundle/types";
import { normalizeProject } from "../shared/project/migrate";
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

  // Every read goes through normalizeProject: the old bare `as Project` cast
  // was an unchecked assertion over disk data, safe only while the shape never
  // changed. It changes now, and normalizeProject(null) is exactly
  // defaultProject, so the missing-file case needs no separate branch.
  const projectPath = join(root, PROJECT_FILE);
  const saved = existsSync(projectPath) ? JSON.parse(readFileSync(projectPath, "utf8")) : null;
  const project: Project = normalizeProject(saved, manifest.id);

  return {
    dir: root,
    manifest,
    telemetry,
    project,
    hasSavedPlan: Array.isArray(saved?.zoom?.segments),
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
  const root = resolve(dir);
  const manifest = parseManifest(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")));
  if (project.bundleId !== manifest.id) throw new Error("This project belongs to a different recording. Reopen the recording and try again.");
  const contents = `${JSON.stringify(project, null, 2)}\n`;
  const temporary = join(root, `.project-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: "utf8", flag: "wx" });
    // A failed write never truncates the last saved project.
    renameSync(temporary, join(root, PROJECT_FILE));
  } finally {
    rmSync(temporary, { force: true });
  }
}
