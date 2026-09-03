/**
 * Decode verification: render frames through the real VideoSource + Renderer,
 * then prove each render is the frame that actually sits at that timestamp.
 *
 * This exists because a seek landing on the wrong frame is invisible to unit
 * tests and easy to miss by eye — a B-frame composition offset shifted every
 * frame by 50ms and looked entirely plausible until compared side by side.
 *
 * Two decisions here were arrived at the hard way:
 *
 * 1. References come from decoding the fixture ONCE, in order, with no seeking
 *    at all. Every seek-based approach produced false failures: `-ss <boundary>`
 *    and `-ss <midpoint>` disagree by three frames, and `select=eq(n\,IDX)`
 *    cannot survive comma escaping through execFileSync. Sequential decode has
 *    no seek semantics to get wrong.
 *
 * 2. The oracle is *relative*. Absolute PSNR is useless: our frames reach RGB
 *    through Chromium's YUV conversion and ffmpeg's through its own, and on
 *    testsrc2's saturated primaries that disagreement alone costs ~25dB. So we
 *    score each render against neighbouring frames and require the exact one to
 *    win. Colour conversion penalises every candidate equally, so the argmax
 *    stays honest.
 *
 * Run: npm run verify:decode
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "tmp", "verify-decode");
const REF = join(OUT, "ref");
const FIXTURE = join(ROOT, "tests", "fixtures", "basic", "screen.mp4");
const FPS = 60;

/** Frame offsets to score against. 0 must win every time. */
const NEIGHBOURS = [-3, -1, 0, 1, 3];
const TIMES_MS = [0, 500, 1200, 2500, 3350, 4900];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(REF, { recursive: true });

// --------------------------------------------------------------- references

console.log("decoding the fixture in order (no seeking)...");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    FIXTURE,
    "-start_number",
    "0",
    join(REF, "%04d.png"),
  ],
  { stdio: "inherit" },
);

const refPath = (frameIndex: number): string =>
  join(REF, `${String(frameIndex).padStart(4, "0")}.png`);

// ------------------------------------------------------------------ renders

const specs = TIMES_MS.map((tMs) => ({
  zoom: { scale: 1, cx: 0.5, cy: 0.5 },
  outputSize: { w: 1920, h: 1080 },
  style: {
    paddingFactor: 1,
    cornerRadiusPx: 0,
    shadow: { blurPx: 0, opacity: 0, offsetYPx: 0 },
  },
  video: `zc://app/@fs/${FIXTURE.replace(/\\/g, "/")}`,
  tMs,
}));

writeFileSync(join(OUT, "spec.json"), JSON.stringify(specs, null, 2), "utf8");

console.log(`rendering ${specs.length} frames through the app...`);

const shoot = spawnSync("npx", ["electron", "."], {
  cwd: ROOT,
  env: {
    ...process.env,
    ZOOMCAST_SHOOT: JSON.stringify(specs),
    ZOOMCAST_SHOOT_DIR: OUT,
  },
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (shoot.status !== 0) {
  console.error(shoot.stdout, shoot.stderr);
  throw new Error(`shoot failed with status ${shoot.status ?? "null"}`);
}

// ------------------------------------------------------------------ scoring

/** Luma-only PSNR, which sidesteps most of the colour-matrix disagreement. */
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

for (const [i, tMs] of TIMES_MS.entries()) {
  const mine = join(OUT, `shot-${String(i).padStart(2, "0")}.png`);
  const expectedFrame = Math.round((tMs * FPS) / 1000);

  let bestOffset = Number.NaN;
  let bestScore = Number.NEGATIVE_INFINITY;
  const scores: Record<string, string> = {};

  for (const k of NEIGHBOURS) {
    const frameIndex = expectedFrame + k;
    const ref = refPath(frameIndex);
    if (frameIndex < 0 || !existsSync(ref)) continue;

    const db = psnr(mine, ref);
    scores[`k=${k}`] = db === Number.POSITIVE_INFINITY ? "inf" : db.toFixed(1);

    if (db > bestScore) {
      bestScore = db;
      bestOffset = k;
    }
  }

  const ok = bestOffset === 0;
  if (!ok) failures++;

  rows.push({
    tMs,
    frame: expectedFrame,
    ...scores,
    best: `k=${bestOffset}`,
    verdict: ok ? "match" : "OFF BY FRAMES",
  });
}

console.table(rows);

if (failures > 0) {
  throw new Error(
    `${failures} of ${TIMES_MS.length} renders matched a neighbouring frame better than the requested one`,
  );
}

console.log(`all ${TIMES_MS.length} renders are the frame at that timestamp`);
