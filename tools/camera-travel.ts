/**
 * How far does the camera actually move while it is zoomed in?
 *
 * Written 2026-09-07, when the complaint was "the section is zooming and
 * getting cropped, I want the camera to zoom and travel". The number that
 * settled it: a fixed segment moves 0px/s during its hold — it eases in,
 * freezes, and eases out — where a follow segment moves 45-76px/s on the takes
 * on disk. Motion during the TRANSITIONS is not the question; motion during
 * the HOLD is, so that is what this measures.
 *
 *   npm run camera:travel -- <take id>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTelemetry } from "../src/shared/bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG as cfg } from "../src/shared/zoom/config";
import { planZoom } from "../src/shared/zoom/planner";
import { segmentsToKeyframes } from "../src/shared/zoom/keyframes";
import { followPath } from "../src/shared/zoom/camera";
import { zoomAt } from "../src/shared/zoom/interpolate";

const TAKE = process.argv[2] ?? "2026-09-06T17-50-34";
if (process.argv[2] === undefined) console.log("(no take given, using the default)");
const SRC = join(homedir(), "AppData", "Local", "zoomcast", "recordings", TAKE);
const man = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8")) as { durationMs: number; video: { width: number; height: number } };
const events = parseTelemetry(readFileSync(join(SRC, "input.jsonl"), "utf8"));
const ctx = { source: { w: man.video.width, h: man.video.height }, output: { w: man.video.width, h: man.video.height }, paddingFactor: 0.85, durationMs: man.durationMs };

const planned = planZoom(events, cfg, ctx);
const path = followPath(events);

console.log(`\n=== ${TAKE}: ${planned.length} segments ===`);
for (const [name, position] of [["fixed ", "fixed"], ["follow", "follow"]] as const) {
  const kfs = segmentsToKeyframes(planned.map((s) => ({ ...s, position })), cfg, ctx, path);

  // Motion DURING the hold only: after the camera has arrived, before it leaves.
  let held = 0;
  let moved = 0;
  for (const s of planned) {
    const from = (s.waypoints[s.waypoints.length - 1]?.tMs ?? 0) + 50;
    const to = s.endMs - cfg.transitionMs - 50;
    let prev = zoomAt(kfs, from);
    for (let t = from + 50; t <= to; t += 50) {
      const z = zoomAt(kfs, t);
      moved += Math.hypot((z.cx - prev.cx) * ctx.source.w, (z.cy - prev.cy) * ctx.source.h);
      prev = z;
      held += 50;
    }
  }
  console.log(`${name}: ${(held / 1000).toFixed(1)}s held, camera moves ${moved.toFixed(0)}px during the hold = ${(moved / (held / 1000)).toFixed(0)}px/s`);
}
