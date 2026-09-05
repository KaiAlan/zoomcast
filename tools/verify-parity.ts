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
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "tmp", "parity");
const BUNDLE = join(ROOT, "tests", "fixtures", "basic");
const MP4 = join(OUT, "export.mp4");

/**
 * Output times to compare, in ms. 0, 1000, 2500 and 4600 straddle the zoom
 * transition. 1900 lands inside the fixture's second click's ripple window
 * ([1805, 2255) at 450ms duration) — without it this guard never rendered a
 * ripple in either path, so a preview-only or export-only ripple regression
 * would pass silently.
 */
const SHOTS = [0, 1000, 1900, 2500, 4600];
const MIN_PSNR_DB = 28;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log("exporting headlessly and capturing preview frames...");

const run = spawnSync("npx", ["electron", "."], {
  cwd: ROOT,
  env: {
    ...process.env,
    ZOOMCAST_PARITY: BUNDLE,
    ZOOMCAST_PARITY_OUT: MP4,
    ZOOMCAST_PARITY_SHOTS: SHOTS.join(","),
  },
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  throw new Error(`parity run failed with status ${run.status ?? "null"}`);
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
const rows: Array<Record<string, string | number>> = [];

for (const t of SHOTS) {
  const exported = join(OUT, `exported-${t}.png`);

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      (t / 1000).toFixed(6),
      "-i",
      MP4,
      "-frames:v",
      "1",
      exported,
    ],
    { stdio: "inherit" },
  );

  const db = psnr(join(OUT, `preview-${t}.png`), exported);
  const ok = db >= MIN_PSNR_DB;
  if (!ok) failures++;

  rows.push({
    tMs: t,
    psnrDb: db === Number.POSITIVE_INFINITY ? "identical" : db.toFixed(1),
    verdict: ok ? "match" : "DIVERGED",
  });
}

console.table(rows);

if (failures > 0) {
  throw new Error(
    `${failures} of ${SHOTS.length} frames diverged between preview and export (PSNR < ${MIN_PSNR_DB}dB)`,
  );
}

console.log("preview and export agree at every sampled time");
