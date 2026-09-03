import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryEvent } from "../src/shared/bundle/types";

const FPS = 60;
const W = 1920;
const H = 1080;

type Preset = {
  name: string;
  durationS: number;
  /** [timeMs, x, y, typingKeystrokes] */
  clicks: Array<[number, number, number, number]>;
};

/**
 * `basic` is the committed 5s fixture the tests rely on — small, fast, and
 * deliberately unchanged.
 *
 * `spread` exists to judge how the planner *feels*. At default settings a 5s
 * clip can only ever justify one zoom (minHoldMs is 1500), so `basic` says
 * nothing about pacing. `spread` puts six well-separated points of attention in
 * distinct screen regions, which is what a real walkthrough looks like.
 */
const PRESETS: Record<string, Preset> = {
  basic: {
    name: "basic",
    durationS: 5,
    clicks: [
      [400, 300, 250, 0],
      [1800, 1500, 800, 12],
      [3600, 960, 540, 0],
    ],
  },
  spread: {
    name: "spread",
    durationS: 30,
    clicks: [
      [1500, 300, 250, 0],
      [6000, 1600, 850, 14],
      [11000, 960, 540, 0],
      [16000, 350, 820, 10],
      [21500, 1500, 260, 0],
      [26500, 900, 160, 8],
    ],
  },
};

const presetName = process.argv[2] ?? "basic";
const preset = PRESETS[presetName];

if (preset === undefined) {
  throw new Error(
    `unknown preset "${presetName}" — expected one of ${Object.keys(PRESETS).join(", ")}`,
  );
}

const OUT = join(process.cwd(), "tests", "fixtures", preset.name);
mkdirSync(OUT, { recursive: true });

const ff = (args: string[]): void => {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });
};

console.log(`generating "${preset.name}" (${preset.durationS}s)…`);

// Test pattern matching the capture settings in spec §5
ff([
  "-f", "lavfi",
  "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${preset.durationS}`,
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
    "-i", `sine=frequency=${freq}:duration=${preset.durationS}`,
    "-c:a", "libopus",
    "-b:a", "96k",
    join(OUT, file),
  ]);
}

const events: TelemetryEvent[] = [];

for (const [t, x, y, keystrokes] of preset.clicks) {
  events.push({ t, k: "move", x, y });
  events.push({ t: t + 5, k: "down", x, y, b: 1 });
  events.push({ t: t + 60, k: "up", x, y, b: 1 });

  for (let i = 0; i < keystrokes; i++) {
    events.push({ t: t + 200 + i * 90, k: "key", d: "down", c: "KeyA" });
  }
}

events.sort((a, b) => a.t - b.t);

writeFileSync(
  join(OUT, "input.jsonl"),
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  "utf8",
);

const manifest = {
  version: 1,
  id: `fixture-${preset.name}`,
  createdAt: new Date(0).toISOString(),
  clockBaseUnixMs: 0,
  status: "clean",
  durationMs: preset.durationS * 1000,
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
