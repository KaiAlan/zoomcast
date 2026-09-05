/**
 * Preview/export parity.
 *
 * The design rests on one structural claim: preview and export call the same
 * Renderer, so what you see is what you get by construction. This checks it.
 *
 * Runs a real export headlessly, captures preview frames from the same editor
 * instance at the same output times, and compares each pair. The exported frame
 * has been through H.264, so the comparison is thresholded rather than exact —
 * but a drift in zoom, padding, crop or orientation would show up immediately,
 * because those move pixels far more than compression does.
 *
 * Run: npm run verify:parity
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProject } from "../src/shared/project/migrate";
import type { Project } from "../src/shared/project/types";

const ROOT = process.cwd();
const OUT = join(ROOT, "tmp", "parity");
const BUNDLE = join(ROOT, "tests", "fixtures", "basic");

/**
 * Output times to compare, in ms. 0, 1000, 2500 and 4600 straddle the zoom
 * transition. 1900 lands inside the fixture's second click's ripple window
 * ([1805, 2255) at 450ms duration) — without it this guard never rendered a
 * ripple in either path, so a preview-only or export-only ripple regression
 * would pass silently.
 */
const SHOTS = [0, 1000, 1900, 2500, 4600];
const MIN_PSNR_DB = 28;

/**
 * Configurations to check, not just times.
 *
 * A guard only guards what it exercises. Running the default project alone
 * left the border pass, the image branch, the frame presets and every
 * non-native aspect completely unguarded against a preview/export divergence —
 * which is the one thing this tool exists to catch, and the bug it missed
 * twice in the cursor phase.
 *
 * "default" stays first and unchanged, so a regression in the ordinary path is
 * still reported the way it always was. "styled" turns on everything the
 * default leaves off, and "square" is the only check that the two paths agree
 * on output size at all — they compute it separately.
 */
const CONFIGS: Array<{ name: string; style?: Partial<Project["style"]>; output?: Partial<Project["output"]> }> = [
  { name: "default" },
  {
    name: "styled",
    style: {
      background: {
        kind: "color",
        preset: "aurora",
        color: "#402030",
        imageFile: null,
        blur: "none",
      },
      frame: {
        preset: "minimal",
        cornerRadiusPx: 12,
        shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
        border: { visible: true, widthPx: 3, color: "#ffffffcc" },
      },
    },
  },
  { name: "square", output: { aspect: "1:1" } },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/**
 * A scratch copy of the fixture carrying a project.json for this config.
 *
 * Built through normalizeProject rather than by hand, so a field added to
 * Project without a migration entry fails here as well as in the app.
 */
function prepare(config: (typeof CONFIGS)[number]): { dir: string; mp4: string } {
  const dir = join(OUT, config.name);
  cpSync(BUNDLE, dir, { recursive: true });

  const base = normalizeProject(null, "fixture-basic");
  const project: Project = {
    ...base,
    style: { ...base.style, ...config.style },
    output: { ...base.output, ...config.output },
  };

  writeFileSync(join(dir, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  // The mp4 lives INSIDE dir because the parity mode writes its preview PNGs
  // to dirname(out); putting it a level up scatters previews across configs.
  return { dir, mp4: join(dir, "export.mp4") };
}

function psnr(a: string, b: string): number {
  const res = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      a,
      "-i",
      b,
      "-lavfi",
      "[0:v]format=gray[x];[1:v]format=gray[y];[x][y]psnr",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", shell: process.platform === "win32" },
  );

  const text = `${res.stdout}${res.stderr}`;
  const match = /average:([0-9.]+|inf)/.exec(text);
  if (match === null) throw new Error(`could not parse psnr output:\n${text}`);

  return match[1] === "inf" ? Number.POSITIVE_INFINITY : Number(match[1]);
}

let failures = 0;
let checked = 0;
const rows: Array<Record<string, string | number>> = [];

for (const config of CONFIGS) {
  const { dir, mp4 } = prepare(config);

  console.log(`exporting headlessly and capturing preview frames (${config.name})...`);

  const run = spawnSync("npx", ["electron", "."], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZOOMCAST_PARITY: dir,
      ZOOMCAST_PARITY_OUT: mp4,
      ZOOMCAST_PARITY_SHOTS: SHOTS.join(","),
    },
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    throw new Error(`parity run failed for "${config.name}" with status ${run.status ?? "null"}`);
  }

  for (const t of SHOTS) {
    const exported = join(dir, `exported-${t}.png`);

    execFileSync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-ss", (t / 1000).toFixed(6),
       "-i", mp4, "-frames:v", "1", exported],
      { stdio: "inherit" },
    );

    const db = psnr(join(dir, `preview-${t}.png`), exported);
    const ok = db >= MIN_PSNR_DB;
    checked++;
    if (!ok) failures++;

    rows.push({
      config: config.name,
      tMs: t,
      psnrDb: db === Number.POSITIVE_INFINITY ? "identical" : db.toFixed(1),
      verdict: ok ? "match" : "DIVERGED",
    });
  }
}

console.table(rows);

if (failures > 0) {
  throw new Error(
    `${failures} of ${checked} frames diverged between preview and export (PSNR < ${MIN_PSNR_DB}dB)`,
  );
}

console.log(`preview and export agree at every sampled time (${checked} comparisons)`);
