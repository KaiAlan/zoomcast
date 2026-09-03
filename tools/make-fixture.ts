import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryEvent } from "../src/shared/bundle/types";

const OUT = join(process.cwd(), "tests", "fixtures", "basic");
const DURATION_S = 5;
const FPS = 60;
const W = 1920;
const H = 1080;

mkdirSync(OUT, { recursive: true });

const ff = (args: string[]): void => {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });
};

// 5s 1080p60 test pattern, GOP 30 — matches the capture settings in spec §5
ff([
  "-f", "lavfi",
  "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${DURATION_S}`,
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-g", "30",
  "-keyint_min", "30",
  "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  join(OUT, "screen.mp4"),
]);

// Distinguishable tones so a mixdown can be told apart by ear
for (const [file, freq] of [
  ["mic.webm", 440],
  ["system.webm", 220],
] as const) {
  ff([
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${DURATION_S}`,
    "-c:a", "libopus",
    "-b:a", "96k",
    join(OUT, file),
  ]);
}

// Telemetry: three clicks at distinct points, with a typing burst after the second
const events: TelemetryEvent[] = [];

const click = (t: number, x: number, y: number): void => {
  events.push({ t, k: "move", x, y });
  events.push({ t: t + 5, k: "down", x, y, b: 1 });
  events.push({ t: t + 60, k: "up", x, y, b: 1 });
};

click(400, 300, 250);
click(1800, 1500, 800);
for (let i = 0; i < 12; i++) {
  events.push({ t: 2000 + i * 90, k: "key", d: "down", c: "KeyA" });
}
click(3600, 960, 540);

events.sort((a, b) => a.t - b.t);

writeFileSync(
  join(OUT, "input.jsonl"),
  events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  "utf8",
);

const manifest = {
  version: 1,
  id: "fixture-basic",
  createdAt: new Date(0).toISOString(),
  clockBaseUnixMs: 0,
  status: "clean",
  durationMs: DURATION_S * 1000,
  display: {
    adapter: "fixture",
    outputIdx: 0,
    width: W,
    height: H,
    refreshHz: 144,
    scale: 1,
  },
  video: {
    file: "screen.mp4",
    codec: "h264",
    encoder: "libx264",
    width: W,
    height: H,
    fps: FPS,
    gop: 30,
    drawMouse: false,
    startOffsetMs: 0,
  },
  audio: [
    { role: "mic", file: "mic.webm", codec: "opus", startOffsetMs: 142 },
    { role: "system", file: "system.webm", codec: "opus", startOffsetMs: 138 },
  ],
  telemetry: { file: "input.jsonl", hasCursorShapes: false },
};

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

console.log(`fixture written to ${OUT}`);
