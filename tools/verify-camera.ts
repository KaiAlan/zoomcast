/** Compare camera timing and rendered motion against HEAD over real takes. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseTelemetry } from "../src/shared/bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG as config } from "../src/shared/zoom/config";
import { planZoom } from "../src/shared/zoom/planner";
import { segmentsToKeyframes } from "../src/shared/zoom/keyframes";
import { zoomAt } from "../src/shared/zoom/interpolate";
import { screenQuadFor } from "../src/shared/zoom/viewport";
import { followPath } from "../src/shared/zoom/camera";
import type { TelemetryEvent } from "../src/shared/bundle/types";
import type { PlanContext } from "../src/shared/zoom/types";

const scratch = join(process.cwd(), "tmp", "camera-baseline");
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "src/shared"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));
for (const file of files) {
  const target = join(scratch, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, execFileSync("git", ["show", `HEAD:${file}`]));
}
const baselineConfig = (await import(pathToFileURL(join(scratch, "src/shared/zoom/config.ts")).href)).DEFAULT_ZOOM_CONFIG as typeof config;
const baselinePlan = (await import(pathToFileURL(join(scratch, "src/shared/zoom/planner.ts")).href)).planZoom as typeof planZoom;
const baselineFrames = (await import(pathToFileURL(join(scratch, "src/shared/zoom/keyframes.ts")).href)).segmentsToKeyframes as typeof segmentsToKeyframes;
const baselineAt = (await import(pathToFileURL(join(scratch, "src/shared/zoom/interpolate.ts")).href)).zoomAt as typeof zoomAt;
const baselineQuad = (await import(pathToFileURL(join(scratch, "src/shared/zoom/viewport.ts")).href)).screenQuadFor as typeof screenQuadFor;
const context: PlanContext = { source: { w: 1920, h: 1080 }, output: { w: 1920, h: 1080 }, paddingFactor: 0.85, durationMs: 60000 };
const scenarios: Array<{ id: string; events: TelemetryEvent[]; ctx: PlanContext }> = [
  { id: "isolated-click", events: [{ k: "down", t: 10000, x: 400, y: 540, b: 1 }], ctx: context },
  { id: "frequent-clicks", events: [10000, 12500, 15000, 17500].map((t, i) => ({ k: "down", t, x: i % 2 ? 1500 : 400, y: 540, b: 1 })), ctx: context },
];
const recordings = join(process.env.LOCALAPPDATA ?? "", "zoomcast", "recordings");
if (existsSync(recordings)) for (const id of readdirSync(recordings)) {
  const manifestFile = join(recordings, id, "manifest.json");
  const inputFile = join(recordings, id, "input.jsonl");
  if (!existsSync(manifestFile) || !existsSync(inputFile)) continue;
  const m = JSON.parse(readFileSync(manifestFile, "utf8")) as { durationMs: number; video: { width: number; height: number } };
  const events = parseTelemetry(readFileSync(inputFile, "utf8"));
  if (!events.some(e => e.k === "down" || e.k === "wheel" || e.k === "key")) continue;
  scenarios.push({ id, events, ctx: { ...context, durationMs: m.durationMs, source: { w: m.video.width, h: m.video.height }, output: { w: m.video.width, h: m.video.height } } });
}
const rows = [];
for (const scenario of scenarios) for (const engine of ["before", "after"] as const) {
  const cfg = engine === "before" ? baselineConfig : config;
  const segments = (engine === "before" ? baselinePlan : planZoom)(scenario.events, cfg, scenario.ctx);
  const kfs = engine === "before" ? baselineFrames(segments, cfg, scenario.ctx)
    : segmentsToKeyframes(segments, cfg, scenario.ctx, followPath(scenario.events));
  const at = engine === "before" ? baselineAt : zoomAt;
  const quad = engine === "before" ? baselineQuad : screenQuadFor;
  let previous: number[] | undefined;
  let velocity: number[] | undefined;
  let maxSpeed = 0;
  let maxAcceleration = 0;
  let maxSpeedAtMs = 0;
  let maxAccelerationAtMs = 0;
  let sumAcceleration = 0;
  let samples = 0;
  for (let t = 0; t < scenario.ctx.durationMs; t += 1000 / 60) {
    const q = quad(scenario.ctx.source, scenario.ctx.output, scenario.ctx.paddingFactor, at(kfs, t));
    const position = [q.x, q.y, q.x + q.w, q.y + q.h];
    if (previous !== undefined) {
      const v = position.map((p, i) => p - (previous?.[i] ?? 0));
      const speed = Math.max(...v.map(Math.abs));
      if (speed > maxSpeed) { maxSpeed = speed; maxSpeedAtMs = Math.round(t); }
      if (velocity !== undefined) {
        const a = Math.max(...v.map((n, i) => Math.abs(n - (velocity?.[i] ?? 0))));
        if (a > maxAcceleration) { maxAcceleration = a; maxAccelerationAtMs = Math.round(t); }
        sumAcceleration += a * a;
        samples++;
      }
      velocity = v;
    }
    previous = position;
  }
  if (engine === "after") {
    for (let i = 1; i < kfs.length; i++) if ((kfs[i]?.tSourceMs ?? 0) <= (kfs[i - 1]?.tSourceMs ?? 0)) throw new Error(`${scenario.id}: duplicate/reversed keyframe`);
    if (kfs.some(k => k.tSourceMs > scenario.ctx.durationMs)) throw new Error(`${scenario.id}: keyframe beyond take`);
  }
  rows.push({ id: scenario.id, engine, shots: segments.length, maxPixelsPerFrame: Number(maxSpeed.toFixed(2)), maxAcceleration: Number(maxAcceleration.toFixed(2)), rmsAcceleration: Number(Math.sqrt(sumAcceleration / Math.max(1, samples)).toFixed(3)), maxSpeedAtMs, maxAccelerationAtMs, firstMoveStartsMs: kfs[0] === undefined ? null : kfs[0].tSourceMs - kfs[0].transitionMs });
}
console.table(rows);
writeFileSync(join(process.cwd(), "tmp", "camera-validation.json"), JSON.stringify(rows, null, 2));
