/**
 * What the preview actually achieves while playing.
 *
 * The handover claimed the preview was "smoother" twice with no number behind
 * it. This is that number. Run it several times: between machine states the
 * result moves a lot (9.6 and 20.7fps were both measured on the same code and
 * take), while back-to-back runs sit within a few percent — so compare a batch
 * against a batch, never a single run against a single run.
 *
 * Run: npm run bench:preview -- [take|bundle-dir] [ms] [runs]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const arg = process.argv[2] ?? "";
const ms = process.argv[3] ?? "6000";
const runs = Number(process.argv[4] ?? "3");

const dir = existsSync(arg)
  ? arg
  : join(homedir(), "AppData", "Local", "zoomcast", "recordings", arg);

if (!existsSync(dir)) {
  console.error(`no such bundle: ${dir}`);
  process.exit(1);
}

const out = join(process.cwd(), "tmp", "preview-bench.json");
const fps: number[] = [];

for (let i = 0; i < runs; i++) {
  const run = spawnSync("npx", ["electron", "."], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ZOOMCAST_PREVIEW_BENCH: dir,
      ZOOMCAST_PREVIEW_BENCH_MS: ms,
      ZOOMCAST_PREVIEW_BENCH_OUT: out,
    },
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    throw new Error("bench run failed");
  }

  const r = JSON.parse(readFileSync(out, "utf8")) as {
    fps: number;
    p50DeltaMs: number;
    p95DeltaMs: number;
    worstDeltaMs: number;
    frames: number;
    droppedTicks: number;
  };
  fps.push(r.fps);
  console.log(
    `run ${i + 1}: ${r.fps.toFixed(1)}fps  p50 ${r.p50DeltaMs.toFixed(0)}ms  ` +
      `p95 ${r.p95DeltaMs.toFixed(0)}ms  worst ${r.worstDeltaMs.toFixed(0)}ms  ` +
      `(${r.frames} frames, ${r.droppedTicks} ticks dropped)`,
  );
}

const sorted = [...fps].sort((a, b) => a - b);
console.log(
  `\nmedian ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)}fps ` +
    `over ${runs} runs, spread ${sorted[0]?.toFixed(1)}-${sorted[sorted.length - 1]?.toFixed(1)}`,
);
