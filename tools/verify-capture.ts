/**
 * Capture verification: does this machine actually record through ddagrab, and
 * at the rate it asked for?
 *
 * This exists because the answer was "no" for the entire life of the project
 * and nothing said so. `probeBackend` was `catch { return "gdigrab" }`, so a
 * machine silently capturing at 32fps was indistinguishable from a machine
 * without Desktop Duplication at all. Every take was on the CPU fallback.
 *
 * It drives the real `probeCapture` and the real `ScreenSource` — the same code
 * the app runs — rather than a hand-written ffmpeg command line, so a chain
 * that only works when typed out by hand still fails here. Electron is not
 * needed: nothing in that path imports it.
 *
 * Run: npm run verify:capture [seconds]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pickEncoder } from "../src/main/ffmpeg";
import {
  probeCapture,
  probeRecording,
  ScreenSource,
} from "../src/main/capture/ScreenSource";

const SECONDS = Number(process.argv[2] ?? 8);
const FPS = 60;

/** Below this and the fallback is doing the work, whatever the backend says. */
const MIN_ACCEPTABLE_FPS = 50;

const OUT = join(process.cwd(), "tmp", "verify-capture");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const log = (where: string, detail: unknown): void => {
  console.log(`  ${where}: ${detail instanceof Error ? detail.message : String(detail)}`);
};

console.log("probing...");
const target = await probeCapture(log);
const encoder = await pickEncoder();

console.log(
  `\nbackend=${target.backend} dx:${target.adapterIndex} output=${target.outputIndex} encoder=${encoder}`,
);

const outFile = join(OUT, "screen.mp4");
console.log(`recording ${SECONDS}s at ${FPS}fps...`);

const source = await ScreenSource.start(target.backend, {
  outFile,
  fps: FPS,
  gop: FPS,
  encoder,
  drawMouse: false,
  adapterIndex: target.adapterIndex,
  outputIndex: target.outputIndex,
});

await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
await source.stop();

const recorded = await probeRecording(outFile);

// avg_frame_rate is a nominal container rate and has reported a flattering
// "44fps" for a take that held 28. Count the frames instead.
const counted = Number(
  execFileSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-count_frames",
      "-show_entries", "stream=nb_read_frames",
      "-of", "default=nw=1:nk=1",
      outFile,
    ],
    { encoding: "utf8" },
  ).trim(),
);

const achieved = counted / (recorded.durationMs / 1000);

console.log(
  `\ncapture:rate: backend=${target.backend} requested=${FPS} ` +
    `achieved=${achieved.toFixed(2)} size=${recorded.width}x${recorded.height} ` +
    `frames=${counted} durationMs=${recorded.durationMs}`,
);

if (source.unclean) {
  console.error(`\nFAIL: capture exited uncleanly\n${source.diagnostics}`);
  process.exit(1);
}

if (target.backend !== "ddagrab") {
  console.error(
    `\nFAIL: fell back to ${target.backend}. The probe lines above say why — ` +
      `that is the whole point of them.`,
  );
  process.exit(1);
}

if (achieved < MIN_ACCEPTABLE_FPS) {
  console.error(`\nFAIL: ${achieved.toFixed(2)}fps is below ${MIN_ACCEPTABLE_FPS}`);
  process.exit(1);
}

console.log(`\nPASS: ddagrab at ${achieved.toFixed(2)}fps`);
