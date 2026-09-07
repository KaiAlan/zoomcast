/**
 * Render one take twice — every zoom fixed, then every zoom following — so the
 * two camera modes can be watched side by side.
 *
 * The planner only ever emits "fixed" and there is no UI switch yet, so this
 * is currently the only way to see the follow camera on real footage. Writes
 * to tmp/camera/<take>/{a-fixed,b-follow}/.
 *
 *   npm run render:camera -- <take id>
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeProject } from "../src/shared/project/migrate";
import { planZoom } from "../src/shared/zoom/planner";
import { DEFAULT_ZOOM_CONFIG } from "../src/shared/zoom/config";
import { parseTelemetry } from "../src/shared/bundle/telemetry";

const TAKE = process.argv[2] ?? "2026-09-06T17-50-34";
const SRC = join(homedir(), "AppData", "Local", "zoomcast", "recordings", TAKE);
const OUT = join(process.cwd(), "tmp", "camera", TAKE.replace(/:/g, "-"));

const man = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8")) as {
  durationMs: number;
  video: { width: number; height: number };
};
const events = parseTelemetry(readFileSync(join(SRC, "input.jsonl"), "utf8"));
const ctx = {
  source: { w: man.video.width, h: man.video.height },
  output: { w: man.video.width, h: man.video.height },
  paddingFactor: 0.85,
  durationMs: man.durationMs,
};

const planned = planZoom(events, DEFAULT_ZOOM_CONFIG, ctx);
console.log(`${TAKE}: ${planned.length} segments`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [name, position] of [["a-fixed", "fixed"], ["b-follow", "follow"]] as const) {
  const dir = join(OUT, name);
  cpSync(SRC, dir, { recursive: true });

  const base = normalizeProject(null, TAKE);
  // Pinned and manual so replanSegments keeps them through the load re-plan.
  const segments = planned.map((s) => ({ ...s, position, origin: "manual" as const, pinned: true }));
  writeFileSync(
    join(dir, "project.json"),
    `${JSON.stringify({ ...base, zoom: { ...base.zoom, segments } }, null, 2)}\n`,
    "utf8",
  );

  const mp4 = join(dir, `${name}.mp4`);
  console.log(`rendering ${name}...`);
  const run = spawnSync("npx", ["electron", "."], {
    cwd: process.cwd(),
    env: { ...process.env, ZOOMCAST_PARITY: dir, ZOOMCAST_PARITY_OUT: mp4, ZOOMCAST_PARITY_SHOTS: "" },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    throw new Error(`render failed for ${name}`);
  }
  console.log(`  -> ${mp4}`);
  if (!existsSync(mp4)) throw new Error("no output");
}
