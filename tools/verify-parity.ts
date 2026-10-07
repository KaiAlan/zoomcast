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
import { cpSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultProject } from "../src/shared/project/defaults";
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
const CONFIGS: Array<{
  name: string;
  webcam?: Partial<Project["webcam"]>;
  webcamOffsetMs?: number;
  style?: Partial<Project["style"]>;
  output?: Partial<Project["output"]>;
  zoom?: Partial<Project["zoom"]>;
  cuts?: Project["cuts"];
  clips?: Project["clips"];
  /** Output times to compare when the default SHOTS would overrun a cut config's shorter output. */
  shots?: number[];
}> = [
  { name: "default" },
  ...(["classic", "rounded", "filled", "dot", "outline"] as const).map(appearance => ({
    name: `cursor-${appearance}`,
    style: { cursor: { ...defaultProject("cursor").style.cursor, appearance, sizePct: 250, motionBlur: 0.4, clickBounce: 3.5, bounceDurationMs: 350, sway: 0.2 } },
    shots: [0, 1000, 1900, 2500, 4600],
  })),
  { name: "cursor-loop-cut", style: { cursor: { ...defaultProject("loop").style.cursor, loop: true, sizePct: 250, sway: 0.2, motionBlur: 0.4 } }, cuts: [{ id: "loop-start", startMs: 0, endMs: 500 }, { id: "loop-end", startMs: 4500, endMs: 5000 }], shots: [0, 1000, 1900, 2500, 3983.3333333333335] },
  { name: "bright-gradient", style: { background: { ...defaultProject("bright").style.background, preset: "prism" } } },
  { name: "bundled-wallpaper", style: { background: { ...defaultProject("wallpaper").style.background, kind: "image", imageFile: "background-preset-ribbons.jpg" } } },

  { name: "webcam-circle", webcam: {} },
  { name: "webcam-rounded", webcam: { shape: "rounded", position: "top-left", mirror: false } },
  { name: "webcam-portrait", webcam: { sizePct: 40, position: "top-right" }, output: { aspect: "9:16" } },
  { name: "webcam-hidden", webcam: { visible: false } },
  { name: "webcam-offset-cut", webcam: { position: "bottom-left" }, webcamOffsetMs: 500, cuts: [{ id: "camera-cut", startMs: 1200, endMs: 1800 }], shots: [0, 1000, 1900, 2500, 4000] },
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
      // "default" is the only preset that reads these fields. Under "minimal"
      // resolveFrame returns the preset's own values and every line below is
      // dead — which is what this config used to do, leaving the border pass
      // guarded by a 1px ring at 10% alpha rather than the 3px opaque one it
      // appears to ask for.
      frame: {
        preset: "default",
        cornerRadiusPx: 12,
        shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
        border: { visible: true, widthPx: 3, color: "#ffffffcc" },
      },
    },
  },
  { name: "square", output: { aspect: "1:1" } },
  {
    /**
     * Motion blur on, which nothing else here exercises: it defaults to 0, so
     * every other config takes the `u_blurPx > 0.0` branch's else and the
     * whole directional pass would render unguarded. A guard only guards what
     * it exercises.
     *
     * This is the config that proves the blur is computed on the fixed grid.
     * Preview and export draw the same source times at different real frame
     * rates, so a blur derived from elapsed time rather than BLUR_GRID_MS
     * would diverge here and nowhere else.
     */
    name: "blurred",
    style: { motionBlurAmount: 1 },
  },
  {
    /**
     * The follow camera, which nothing else here exercises: the planner only
     * ever emits "fixed", so without this config the whole follow path — the
     * precomputed camera, its clamp and the 100ms sample keyframes — would
     * render in preview and export with no guard that the two agree.
     *
     * 1:1 on purpose. At the native aspect nothing is ever cropped (cropping
     * would start above 1 / paddingFactor, which is exactly where the ceiling
     * lands), so a follow there has no viewport to move and the config would
     * prove nothing. The segment is pinned so it survives the re-plan the
     * editor plays on load.
     */
    name: "follow",
    output: { aspect: "1:1" },
    zoom: {
      segments: [
        {
          id: "follow-1",
          startMs: 800,
          endMs: 4200,
          position: "follow",
          waypoints: [{ id: "f0", tMs: 800, depth: 1, cx: 0.5, cy: 0.5 }],
          origin: "manual",
          pinned: true,
        },
      ],
    },
  },
  {
    // The one branch that never binds the background program at all, so a
    // divergence in the skip path itself has nowhere else to show up.
    name: "hidden",
    style: {
      background: {
        kind: "hidden",
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
  {
    /**
     * A cut, which nothing else here exercises: the editor and the export
     * each map output time to source time on their own, and a divergence in
     * that mapping is invisible to every config above. 900 and 1100 sit on
     * either side of the seam; the output is 4000ms long, so 4600 is dropped.
     */
    name: "cut",
    cuts: [{ id: "c1", startMs: 1000, endMs: 2000 }],
    shots: [0, 900, 1100, 2500, 3900],
  },
  {
    name: "reordered-clips",
    clips: [{ id: "tail-first", startMs: 3000, endMs: 5000 }, { id: "intro-last", startMs: 0, endMs: 2000 }],
    style: { cursor: { ...defaultProject("test").style.cursor, appearance: "outline", sizePct: 250, motionBlur: 0.5, sway: 0.5 } },
    shots: [0, 1000, 1900, 2500, 3900],
  },
  {
    name: "split-short-zooms",
    zoom: { segments: [
      { id: "short", startMs: 800, endMs: 1300, position: "fixed", waypoints: [{ id: "short-focus", tMs: 800, depth: 1, cx: 0.5, cy: 0.5 }], origin: "manual", pinned: true },
      { id: "long", startMs: 1300, endMs: 4200, position: "follow", waypoints: [{ id: "long-focus", tMs: 1300, depth: 0.4, cx: 0.5, cy: 0.5 }], origin: "manual", pinned: true },
    ] },
    shots: [0, 1000, 1900, 2500, 4600],
  },
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** Key-sorted JSON, so a comparison is about values rather than key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
      : v,
  );
}

/**
 * Fail if a field survives `defaultProject` but not `normalizeProject`.
 *
 * This used to be claimed as a side effect of building the project through
 * `normalizeProject(null, ...)`, which does not hold: that call returns early
 * at `if (!isRecord(raw)) return base`, so the field-by-field body never runs
 * and `defaultProject` passes through untouched. A missing migration entry
 * then produced two identically-wrong renders, and parity compared them and
 * agreed.
 *
 * Writing the project out and reading it back is what actually exercises the
 * migration, which is also exactly what the app does on load.
 */
function assertSurvivesMigration(project: Project): void {
  const roundTripped = normalizeProject(
    JSON.parse(JSON.stringify(project)) as unknown,
    project.bundleId,
  );

  if (stable(roundTripped) !== stable(project)) {
    throw new Error(
      "project.json does not survive normalizeProject — a field in the Project " +
        "type is missing from normalizeProject in src/shared/project/migrate.ts, " +
        "so real projects silently lose it on load.\n" +
        `wrote: ${stable(project)}\nread back: ${stable(roundTripped)}`,
    );
  }
}

/** A scratch copy of the fixture carrying a project.json for this config. */
function prepare(config: (typeof CONFIGS)[number]): { dir: string; mp4: string } {
  const dir = join(OUT, config.name);
  cpSync(BUNDLE, dir, { recursive: true });

  const base = normalizeProject(null, "fixture-basic");
  const project: Project = {
    ...base,
    style: { ...base.style, ...config.style },
    output: { ...base.output, ...config.output },
    zoom: { ...base.zoom, ...config.zoom },
    cuts: config.cuts ?? base.cuts,
    ...(config.clips ? { clips: config.clips } : {}),
    webcam: { ...base.webcam, ...config.webcam },
  };

  if (config.webcam !== undefined) {
    cpSync(join(OUT, "camera.mp4"), join(dir, "webcam.mp4"));
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    manifest.webcam = { file: "webcam.mp4", width: 640, height: 360, fps: 30, startOffsetMs: config.webcamOffsetMs ?? -200 };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  }
  if (config.name === "bundled-wallpaper") cpSync(join(ROOT, "src", "renderer", "public", "backgrounds", "ribbons.jpg"), join(dir, "background-preset-ribbons.jpg"));
  assertSurvivesMigration(project);

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

execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "7", "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-g", "15", join(OUT, "camera.mp4")], { stdio: "ignore" });
const selectedConfigs = process.env.ZOOMCAST_PARITY_CONFIGS?.split(",");
for (const config of CONFIGS.filter(config => !selectedConfigs || selectedConfigs.includes(config.name))) {
  const { dir, mp4 } = prepare(config);
  const shots = config.shots ?? SHOTS;

  console.log(`exporting headlessly and capturing preview frames (${config.name})...`);

  // A running tray app must not share Chromium profile locks or media state.
  const run = spawnSync("npx", ["electron", ".", `--user-data-dir=${join(OUT, "profile")}`], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZOOMCAST_PARITY: dir,
      ZOOMCAST_PARITY_OUT: mp4,
      ZOOMCAST_PARITY_SHOTS: shots.join(","),
    },
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000,
  });

  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    throw new Error(`parity run failed for "${config.name}" with status ${run.status ?? "null"}`);
  }

  for (const t of shots) {
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

// Parity alone could pass if both paths forgot to composite the camera.
if (!selectedConfigs) {
const cameraDifference = psnr(join(OUT, "default", "preview-1000.png"), join(OUT, "webcam-circle", "preview-1000.png"));
if (cameraDifference >= 55) throw new Error("webcam composition did not visibly change preview pixels");
console.log(`webcam visibility guard: ${cameraDifference.toFixed(1)}dB against screen-only preview`);
}
console.table(rows);

if (failures > 0) {
  throw new Error(
    `${failures} of ${checked} frames diverged between preview and export (PSNR < ${MIN_PSNR_DB}dB)`,
  );
}

console.log(`preview and export agree at every sampled time (${checked} comparisons)`);
