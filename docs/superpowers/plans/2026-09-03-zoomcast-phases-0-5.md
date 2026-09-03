# zoomcast Implementation Plan — Phases 0–5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a finished MP4 out of zoomcast without writing a single line of capture code — open a synthetic recording bundle, auto-plan zooms from telemetry, cut it, and export it.

**Architecture:** Pure TypeScript modules under `src/shared/` hold every decision that matters (telemetry parsing, zoom planning, timeline mapping, export planning, ffmpeg argument construction) and run under plain vitest with no Electron and no DOM. Electron and WebGL are glue on top of them. One WebGL2 renderer serves both preview and export, so what you see is what you get by construction.

**Tech Stack:** Electron + electron-vite + TypeScript (strict) + React, vitest + fast-check, zod, mp4box.js, WebCodecs, system ffmpeg 9.0.1.

**Spec:** `docs/specs/2026-09-03-screen-recorder-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Platform:** Windows 11 x64 only. All `npm`, `node` and `git` commands run in **PowerShell** from `C:\dev\zoomcast`. Never from WSL.
- **Toolchain (verified present):** Node 24.19.0, npm 10.8.2, git 2.39.2.windows.1, ffmpeg 9.0.1 on PATH with `ddagrab`, `h264_amf`, `h264_nvenc`, `libx264`.
- **ffmpeg is not vendored.** Resolved from the `ffmpegPath` setting, then PATH.
- **TypeScript `strict: true`.** No `any` in `src/shared/`.
- **Purity rule:** nothing under `src/shared/` may import `electron`, touch the filesystem, or reference DOM globals. It must run in a plain node vitest environment. This is the constraint that keeps the project testable; violating it is the main way this plan fails.
- **Time base:** all timestamps are integer milliseconds since `clockBaseUnixMs`. The screen track is normalised to `startOffsetMs: 0`.
- **The one offset formula:** `streamLocalMs = tSourceMs - stream.startOffsetMs + syncNudgeMs`. No stream may be seeked without going through the helper in Task 4.
- **Schema versions:** manifest `version: 1`, project `version: 1`.
- **Capture defaults:** 1920×1080, 60fps, GOP 30, `drawMouse: false`.
- **Output defaults:** 1920×1080, 60fps, 12 Mbps H.264, `paddingFactor` 0.85 (→ `maxComfortableZoom` ≈ 1.176 on a 1080p source).
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `chore:`, `docs:`).

---

## File Structure

```
C:\dev\zoomcast\
  package.json
  tsconfig.json
  electron.vite.config.ts
  vitest.config.ts
  docs/
    specs/2026-09-03-screen-recorder-design.md
    superpowers/plans/2026-09-03-zoomcast-phases-0-5.md
  tools/
    make-fixture.ts                 # synthetic bundle generator (Task 5)
  tests/
    fixtures/basic/                 # checked-in 5s bundle
    e2e/export.e2e.test.ts          # Task 20
  src/
    shared/                         # PURE. no electron, no DOM, no fs.
      bundle/
        types.ts                    # Manifest, TelemetryEvent, CursorShape
        manifest.ts                 # zod schema + parseManifest
        telemetry.ts                # parseTelemetry
        streamTime.ts               # toStreamLocalMs  ← the one offset helper
      zoom/
        types.ts                    # ZoomConfig, Impulse, Cluster, ZoomKeyframe
        config.ts                   # DEFAULT_ZOOM_CONFIG
        impulses.ts                 # toImpulses
        cluster.ts                  # clusterImpulses, mergeAndFilter
        guards.ts                   # applyGuards
        geometry.ts                 # screenRect, maxComfortableZoom, fitScale
        planner.ts                  # planZoom
        easing.ts                   # cubicBezier, EASINGS
        interpolate.ts              # zoomAt
        replan.ts                   # replan
      project/
        types.ts                    # Project, Cut, StyleConfig, WebcamConfig
        defaults.ts                 # DEFAULT_PROJECT
        cuts.ts                     # normalizeCuts
        timeline.ts                 # sourceToOutput, outputToSource, outputDurationMs
      export/
        exportPlan.ts               # planExportFrames
        ffmpegArgs.ts               # buildExportArgs
    main/
      index.ts                      # BrowserWindow, app lifecycle
      ffmpeg.ts                     # resolveFfmpeg, probeEncoders
      bundleIo.ts                   # read/write bundle + project from disk
      exportRunner.ts               # spawn ffmpeg, own the stdin pipe
      ipc.ts                        # typed IPC surface
    preload/
      index.ts                      # contextBridge
    renderer/
      index.html
      main.tsx
      App.tsx
      gl/
        layout.ts                   # screenQuad  (PURE, tested)
        Renderer.ts                 # WebGL2 compositor
        shaders.ts                  # GLSL source
      media/
        VideoSource.ts              # mp4box demux + WebCodecs decode
        PreviewPlayer.ts            # drives Renderer at display rate
      ui/
        Timeline.tsx
        Inspector.tsx
```

Files that change together live together: everything about zoom planning is one directory, and the pure/impure boundary is a directory boundary rather than a naming convention, so it is enforceable by eye.

---

## Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Test: `src/shared/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev` launches a window; `npm test` runs vitest; path alias `@shared/*` → `src/shared/*`.

- [ ] **Step 1: Initialise the package and install dependencies**

In PowerShell at `C:\dev\zoomcast`:

```powershell
npm init -y
npm i react react-dom zod mp4box
npm i -D electron electron-vite vite typescript tsx @vitejs/plugin-react `
         @types/react @types/react-dom @types/node vitest fast-check
```

- [ ] **Step 2: Write the config files**

`package.json` — replace the `main`, `scripts` and `type` fields:

```json
{
  "name": "zoomcast",
  "version": "0.1.0",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vite/client"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tools", "tests"]
}
```

`electron.vite.config.ts`:

```ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve("src/main/index.ts") } } },
    resolve: { alias: { "@shared": resolve("src/shared") } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve("src/preload/index.ts") } } },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: { rollupOptions: { input: resolve("src/renderer/index.html") } },
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@shared": resolve("src/shared") } },
  test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.ts"] },
});
```

- [ ] **Step 3: Write the minimal Electron shell**

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d0e11",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

`src/preload/index.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("zoomcast", {
  version: "0.1.0",
});
```

`src/renderer/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>zoomcast</title>
  </head>
  <body style="margin:0;background:#0d0e11;color:#e6e6e6;font-family:system-ui">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
```

`src/renderer/App.tsx`:

```tsx
export function App(): JSX.Element {
  return <div style={{ padding: 24 }}>zoomcast</div>;
}
```

- [ ] **Step 4: Write the smoke test**

`src/shared/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Verify both halves run**

```powershell
npm test
npm run typecheck
npm run dev
```

Expected: vitest reports 1 passed; typecheck is silent; a dark window appears reading "zoomcast". Close it.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore: scaffold electron-vite + react + vitest"
```

---

## Task 2: Bundle types and manifest validation

**Files:**
- Create: `src/shared/bundle/types.ts`, `src/shared/bundle/manifest.ts`
- Test: `src/shared/bundle/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Manifest`, `type CursorShape`, `parseManifest(json: unknown): Manifest` (throws `ZodError` on invalid input).

- [ ] **Step 1: Write the failing test**

`src/shared/bundle/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";

const valid = {
  version: 1,
  id: "2026-09-03T14-40-12",
  createdAt: "2026-09-03T14:40:12.331Z",
  clockBaseUnixMs: 1772806812331,
  status: "clean",
  durationMs: 5000,
  display: { adapter: "AMD Radeon(TM) Graphics", outputIdx: 0, width: 1920, height: 1080, refreshHz: 144, scale: 1 },
  video: { file: "screen.mp4", codec: "h264", encoder: "h264_amf", width: 1920, height: 1080, fps: 60, gop: 30, drawMouse: false, startOffsetMs: 0 },
  audio: [{ role: "mic", file: "mic.webm", codec: "opus", startOffsetMs: 142 }],
  telemetry: { file: "input.jsonl", hasCursorShapes: false },
};

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const m = parseManifest(valid);
    expect(m.video.fps).toBe(60);
    expect(m.audio[0]?.startOffsetMs).toBe(142);
  });

  it("defaults audio to an empty array", () => {
    const { audio, ...rest } = valid;
    expect(parseManifest(rest).audio).toEqual([]);
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseManifest({ ...valid, version: 2 })).toThrow();
  });

  it("rejects a negative duration", () => {
    expect(() => parseManifest({ ...valid, durationMs: -1 })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => parseManifest({ ...valid, status: "partial" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bundle/manifest.test.ts`
Expected: FAIL — cannot resolve `./manifest`.

- [ ] **Step 3: Write the implementation**

`src/shared/bundle/types.ts`:

```ts
export type CursorShape =
  | "arrow" | "ibeam" | "hand" | "ns" | "ew" | "nwse" | "nesw" | "wait";

export type TelemetryEvent =
  | { t: number; k: "move"; x: number; y: number }
  | { t: number; k: "down"; x: number; y: number; b: number }
  | { t: number; k: "up"; x: number; y: number; b: number }
  | { t: number; k: "key"; d: "down" | "up"; c: string }
  | { t: number; k: "wheel"; x: number; y: number; dy: number }
  | { t: number; k: "cursor"; shape: CursorShape };
```

`src/shared/bundle/manifest.ts`:

```ts
import { z } from "zod";

const AudioTrack = z.object({
  role: z.enum(["mic", "system"]),
  file: z.string(),
  codec: z.string(),
  startOffsetMs: z.number(),
  device: z.string().optional(),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  clockBaseUnixMs: z.number(),
  status: z.enum(["clean", "unclean"]),
  durationMs: z.number().nonnegative(),
  display: z.object({
    adapter: z.string(),
    outputIdx: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    refreshHz: z.number().positive(),
    scale: z.number().positive(),
  }),
  video: z.object({
    file: z.string(),
    codec: z.string(),
    encoder: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    gop: z.number().int().positive(),
    drawMouse: z.boolean(),
    startOffsetMs: z.number(),
  }),
  audio: z.array(AudioTrack).default([]),
  webcam: z
    .object({
      file: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().positive(),
      startOffsetMs: z.number(),
    })
    .optional(),
  telemetry: z
    .object({ file: z.string(), hasCursorShapes: z.boolean() })
    .optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(json: unknown): Manifest {
  return ManifestSchema.parse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/bundle/manifest.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/bundle
git commit -m "feat: bundle manifest schema and validation"
```

---

## Task 3: Telemetry parsing

**Files:**
- Create: `src/shared/bundle/telemetry.ts`
- Test: `src/shared/bundle/telemetry.test.ts`

**Interfaces:**
- Consumes: `TelemetryEvent` from `src/shared/bundle/types.ts`.
- Produces: `parseTelemetry(text: string): TelemetryEvent[]` — sorted by `t`, malformed lines skipped.

Why skipping matters: an ffmpeg or app crash leaves a half-written final line in `input.jsonl`. A parser that throws would make every crashed recording unopenable, which is the opposite of the degradation policy in spec §13.

- [ ] **Step 1: Write the failing test**

`src/shared/bundle/telemetry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTelemetry } from "./telemetry";

describe("parseTelemetry", () => {
  it("parses one event per line", () => {
    const text = [
      '{"t":100,"k":"move","x":10,"y":20}',
      '{"t":200,"k":"down","x":10,"y":20,"b":1}',
    ].join("\n");
    expect(parseTelemetry(text)).toHaveLength(2);
  });

  it("skips blank lines", () => {
    const text = '\n{"t":100,"k":"move","x":1,"y":2}\n\n';
    expect(parseTelemetry(text)).toHaveLength(1);
  });

  it("skips a truncated final line", () => {
    const text = '{"t":100,"k":"move","x":1,"y":2}\n{"t":200,"k":"mo';
    const out = parseTelemetry(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.t).toBe(100);
  });

  it("skips lines missing t or k", () => {
    const text = '{"x":1}\n{"t":5}\n{"t":100,"k":"move","x":1,"y":2}';
    expect(parseTelemetry(text)).toHaveLength(1);
  });

  it("sorts by timestamp", () => {
    const text = [
      '{"t":300,"k":"move","x":1,"y":2}',
      '{"t":100,"k":"move","x":1,"y":2}',
    ].join("\n");
    expect(parseTelemetry(text).map((e) => e.t)).toEqual([100, 300]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bundle/telemetry.test.ts`
Expected: FAIL — cannot resolve `./telemetry`.

- [ ] **Step 3: Write the implementation**

`src/shared/bundle/telemetry.ts`:

```ts
import type { TelemetryEvent } from "./types";

export function parseTelemetry(text: string): TelemetryEvent[] {
  const out: TelemetryEvent[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue; // truncated final line after a crash
    }

    if (typeof value !== "object" || value === null) continue;
    const e = value as Record<string, unknown>;
    if (typeof e.t !== "number" || typeof e.k !== "string") continue;

    out.push(e as unknown as TelemetryEvent);
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/bundle/telemetry.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/bundle
git commit -m "feat: telemetry jsonl parser tolerant of truncated lines"
```

---

## Task 4: Stream time helper

**Files:**
- Create: `src/shared/bundle/streamTime.ts`
- Test: `src/shared/bundle/streamTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `toStreamLocalMs(tSourceMs: number, startOffsetMs: number, syncNudgeMs?: number): number`.

This is four lines of code and it gets its own module because every A/V drift bug in this project will come from doing it inline and getting the sign backwards.

- [ ] **Step 1: Write the failing test**

`src/shared/bundle/streamTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toStreamLocalMs } from "./streamTime";

describe("toStreamLocalMs", () => {
  it("subtracts a positive start offset", () => {
    // mic started 142ms after the screen, so source 5000 is 4858 into mic.webm
    expect(toStreamLocalMs(5000, 142)).toBe(4858);
  });

  it("is identity for the reference screen track", () => {
    expect(toStreamLocalMs(5000, 0)).toBe(5000);
  });

  it("adds the sync nudge", () => {
    expect(toStreamLocalMs(5000, 142, 50)).toBe(4908);
  });

  it("handles a negative nudge", () => {
    expect(toStreamLocalMs(5000, 142, -50)).toBe(4808);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/bundle/streamTime.test.ts`
Expected: FAIL — cannot resolve `./streamTime`.

- [ ] **Step 3: Write the implementation**

`src/shared/bundle/streamTime.ts`:

```ts
/**
 * Convert a source-timeline position into a position within one stream.
 *
 * `startOffsetMs` is how much LATER than the screen track this stream started,
 * so it is subtracted. Getting this sign backwards produces an export that
 * looks correct and drifts audio the wrong way.
 */
export function toStreamLocalMs(
  tSourceMs: number,
  startOffsetMs: number,
  syncNudgeMs = 0,
): number {
  return tSourceMs - startOffsetMs + syncNudgeMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/bundle/streamTime.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/bundle
git commit -m "feat: single source-to-stream time conversion helper"
```

---

## Task 5: Synthetic fixture generator

**Files:**
- Create: `tools/make-fixture.ts`
- Modify: `package.json` (add `"fixture": "tsx tools/make-fixture.ts"`)
- Output: `tests/fixtures/basic/{manifest.json,screen.mp4,mic.webm,system.webm,input.jsonl}`

**Interfaces:**
- Consumes: `Manifest` from Task 2.
- Produces: a checked-in 5-second bundle at `tests/fixtures/basic/`, used by Tasks 9, 16, 17 and 20.

This is the task that unblocks everything else without any capture code. It uses ffmpeg's `testsrc2` pattern so the frames are visually distinct and frame-accurate seeking can be eyeballed.

- [ ] **Step 1: Write the generator**

`tools/make-fixture.ts`:

```ts
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

// 5s 1080p60 test pattern, GOP 30, matching capture settings
ff([
  "-f", "lavfi",
  "-i", `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${DURATION_S}`,
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
  "-g", "30", "-keyint_min", "30", "-sc_threshold", "0",
  "-pix_fmt", "yuv420p",
  join(OUT, "screen.mp4"),
]);

// A 440Hz tone for mic, a 220Hz tone for system — audible and distinguishable
for (const [file, freq] of [["mic.webm", 440], ["system.webm", 220]] as const) {
  ff([
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${DURATION_S}`,
    "-c:a", "libopus", "-b:a", "96k",
    join(OUT, file),
  ]);
}

// Telemetry: cursor drifts, clicks at three distinct points, typing after the second
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
  display: { adapter: "fixture", outputIdx: 0, width: W, height: H, refreshHz: 144, scale: 1 },
  video: {
    file: "screen.mp4", codec: "h264", encoder: "libx264",
    width: W, height: H, fps: FPS, gop: 30, drawMouse: false, startOffsetMs: 0,
  },
  audio: [
    { role: "mic", file: "mic.webm", codec: "opus", startOffsetMs: 142 },
    { role: "system", file: "system.webm", codec: "opus", startOffsetMs: 138 },
  ],
  telemetry: { file: "input.jsonl", hasCursorShapes: false },
};

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`fixture written to ${OUT}`);
```

- [ ] **Step 2: Add the script and run it**

Add to `package.json` scripts: `"fixture": "tsx tools/make-fixture.ts"`.

```powershell
npm run fixture
```

Expected: five files under `tests\fixtures\basic\`.

- [ ] **Step 3: Verify the fixture is what the manifest claims**

```powershell
ffprobe -v error -select_streams v:0 -count_frames `
        -show_entries stream=nb_read_frames,width,height,avg_frame_rate `
        -of default=nw=1 tests\fixtures\basic\screen.mp4
```

Expected: `width=1920`, `height=1080`, `avg_frame_rate=60/1`, `nb_read_frames=300`.

The fixture's non-negotiable property is that its manifest matches its media. If `nb_read_frames` is not 300, fix the generator before continuing — every later task trusts this.

- [ ] **Step 4: Write a validation test**

`tests/fixtures/fixture.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/shared/bundle/manifest";
import { parseTelemetry } from "../../src/shared/bundle/telemetry";

const DIR = join(process.cwd(), "tests", "fixtures", "basic");

describe("basic fixture", () => {
  it("has a valid manifest", () => {
    const m = parseManifest(JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")));
    expect(m.durationMs).toBe(5000);
    expect(m.video.fps).toBe(60);
    expect(m.audio).toHaveLength(2);
  });

  it("has parseable telemetry containing clicks and keystrokes", () => {
    const events = parseTelemetry(readFileSync(join(DIR, "input.jsonl"), "utf8"));
    expect(events.filter((e) => e.k === "down")).toHaveLength(3);
    expect(events.filter((e) => e.k === "key")).toHaveLength(12);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/fixtures/fixture.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit the generator and the fixture**

The `.gitignore` already negates `tests/fixtures/**/*.mp4` and `*.webm`. Confirm the media is actually staged:

```powershell
git add -A
git status --short tests/fixtures/basic
git commit -m "feat: synthetic recording bundle generator and checked-in fixture"
```

Expected: `screen.mp4`, `mic.webm` and `system.webm` all appear as added. If they do not, the ignore negation is not working — fix it before committing.

---

## Task 6: Zoom config and impulse extraction

**Files:**
- Create: `src/shared/zoom/types.ts`, `src/shared/zoom/config.ts`, `src/shared/zoom/impulses.ts`
- Test: `src/shared/zoom/impulses.test.ts`

**Interfaces:**
- Consumes: `TelemetryEvent` from Task 3.
- Produces: `ZoomConfig`, `DEFAULT_ZOOM_CONFIG`, `Impulse`, `Cluster`, `ZoomKeyframe`, `EasingName`, and `toImpulses(events: TelemetryEvent[], cfg: ZoomConfig): Impulse[]`.

The constraint driving this module: `uiohook-napi` reports keystrokes with **no coordinates**. Typing says *when* attention is focused, never *where*, so keystrokes borrow the most recent click's position.

- [ ] **Step 1: Write the failing test**

`src/shared/zoom/impulses.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { toImpulses } from "./impulses";

const cfg = DEFAULT_ZOOM_CONFIG;

describe("toImpulses", () => {
  it("emits a full-weight impulse for a click", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "down", x: 10, y: 20, b: 1 }];
    expect(toImpulses(ev, cfg)).toEqual([{ t: 100, x: 10, y: 20, w: 1, srcIndex: 0 }]);
  });

  it("emits nothing for movement alone", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "move", x: 10, y: 20 }];
    expect(toImpulses(ev, cfg)).toEqual([]);
  });

  it("anchors typing on a recent click", () => {
    const ev: TelemetryEvent[] = [
      { t: 100, k: "down", x: 500, y: 400, b: 1 },
      { t: 200, k: "move", x: 900, y: 900 },
      { t: 1000, k: "key", d: "down", c: "KeyA" },
    ];
    const out = toImpulses(ev, cfg);
    expect(out[1]).toEqual({ t: 1000, x: 500, y: 400, w: 0.4, srcIndex: 2 });
  });

  it("falls back to cursor position when the click is stale", () => {
    const ev: TelemetryEvent[] = [
      { t: 0, k: "down", x: 500, y: 400, b: 1 },
      { t: 100, k: "move", x: 900, y: 900 },
      { t: 9000, k: "key", d: "down", c: "KeyA" },
    ];
    const out = toImpulses(ev, cfg);
    expect(out[1]).toEqual({ t: 9000, x: 900, y: 900, w: 0.4, srcIndex: 2 });
  });

  it("ignores key-up and typing with no prior position", () => {
    const ev: TelemetryEvent[] = [
      { t: 100, k: "key", d: "down", c: "KeyA" },
      { t: 200, k: "key", d: "up", c: "KeyA" },
    ];
    expect(toImpulses(ev, cfg)).toEqual([]);
  });

  it("emits a light impulse for scrolling", () => {
    const ev: TelemetryEvent[] = [{ t: 100, k: "wheel", x: 10, y: 20, dy: -120 }];
    expect(toImpulses(ev, cfg)[0]?.w).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/impulses.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write the implementation**

`src/shared/zoom/types.ts`:

```ts
export type EasingName = "zoomEase" | "linear";

export type ZoomConfig = {
  keyAnchorWindowMs: number;
  clusterWindowMs: number;
  clusterRadiusPx: number;
  minWeight: number;
  minGapMs: number;
  minHoldMs: number;
  deadzonePx: number;
  maxZoomsPerMinute: number;
  marginPx: number;
  leadInMs: number;
  trailMs: number;
  transitionMs: number;
  easing: EasingName;
};

export type Impulse = {
  t: number;
  x: number;
  y: number;
  w: number;
  srcIndex: number;
};

export type Cluster = {
  startT: number;
  endT: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  weight: number;
  cx: number;
  cy: number;
  anchorIndex: number;
};

export type ZoomKeyframe = {
  id: string;
  tSourceMs: number;
  scale: number;
  cx: number;
  cy: number;
  easing: EasingName;
  transitionMs: number;
  origin: "auto" | "manual";
  pinned: boolean;
};

export type Size = { w: number; h: number };

export type PlanContext = {
  source: Size;
  output: Size;
  paddingFactor: number;
};
```

`src/shared/zoom/config.ts`:

```ts
import type { ZoomConfig } from "./types";

export const DEFAULT_ZOOM_CONFIG: ZoomConfig = {
  keyAnchorWindowMs: 4000,
  clusterWindowMs: 2000,
  clusterRadiusPx: 250,
  minWeight: 0.8,
  minGapMs: 700,
  minHoldMs: 1500,
  deadzonePx: 120,
  maxZoomsPerMinute: 8,
  marginPx: 80,
  leadInMs: 250,
  trailMs: 400,
  transitionMs: 600,
  easing: "zoomEase",
};
```

`src/shared/zoom/impulses.ts`:

```ts
import type { TelemetryEvent } from "../bundle/types";
import type { Impulse, ZoomConfig } from "./types";

const CLICK_WEIGHT = 1;
const KEY_WEIGHT = 0.4;
const WHEEL_WEIGHT = 0.3;

export function toImpulses(events: TelemetryEvent[], cfg: ZoomConfig): Impulse[] {
  const out: Impulse[] = [];
  let lastCursor: { x: number; y: number } | null = null;
  let lastClick: { x: number; y: number; t: number } | null = null;

  events.forEach((e, i) => {
    switch (e.k) {
      case "move":
        lastCursor = { x: e.x, y: e.y };
        break;

      case "down":
        lastCursor = { x: e.x, y: e.y };
        lastClick = { x: e.x, y: e.y, t: e.t };
        out.push({ t: e.t, x: e.x, y: e.y, w: CLICK_WEIGHT, srcIndex: i });
        break;

      case "wheel":
        lastCursor = { x: e.x, y: e.y };
        out.push({ t: e.t, x: e.x, y: e.y, w: WHEEL_WEIGHT, srcIndex: i });
        break;

      case "key": {
        if (e.d !== "down") break;
        const fresh = lastClick !== null && e.t - lastClick.t <= cfg.keyAnchorWindowMs;
        const anchor = fresh ? lastClick : lastCursor;
        if (anchor === null) break;
        out.push({ t: e.t, x: anchor.x, y: anchor.y, w: KEY_WEIGHT, srcIndex: i });
        break;
      }

      default:
        break;
    }
  });

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom/impulses.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: zoom config defaults and attention impulse extraction"
```

---

## Task 7: Impulse clustering

**Files:**
- Create: `src/shared/zoom/cluster.ts`
- Test: `src/shared/zoom/cluster.test.ts`

**Interfaces:**
- Consumes: `Impulse`, `Cluster`, `ZoomConfig` from Task 6.
- Produces: `clusterImpulses(imps: Impulse[], cfg: ZoomConfig): Cluster[]` and `mergeAndFilter(cs: Cluster[], cfg: ZoomConfig): Cluster[]`.

Clustering rather than reacting per-event is what stops three nearby clicks becoming three separate camera moves. Merge runs *before* the weight filter so two individually-weak nearby bursts can combine into one that qualifies.

- [ ] **Step 1: Write the failing test**

`src/shared/zoom/cluster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clusterImpulses, mergeAndFilter } from "./cluster";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import type { Impulse } from "./types";

const cfg = DEFAULT_ZOOM_CONFIG;
const imp = (t: number, x: number, y: number, w = 1, srcIndex = 0): Impulse =>
  ({ t, x, y, w, srcIndex });

describe("clusterImpulses", () => {
  it("merges impulses close in time and space", () => {
    const out = clusterImpulses([imp(100, 500, 500), imp(200, 510, 505)], cfg);
    expect(out).toHaveLength(1);
    expect(out[0]?.weight).toBe(2);
    expect(out[0]?.startT).toBe(100);
    expect(out[0]?.endT).toBe(200);
  });

  it("splits impulses far apart in time", () => {
    const out = clusterImpulses([imp(100, 500, 500), imp(5000, 505, 505)], cfg);
    expect(out).toHaveLength(2);
  });

  it("splits impulses far apart in space", () => {
    const out = clusterImpulses([imp(100, 100, 100), imp(200, 1500, 900)], cfg);
    expect(out).toHaveLength(2);
  });

  it("tracks the bounding box of its members", () => {
    const out = clusterImpulses([imp(100, 400, 400), imp(200, 600, 500)], cfg);
    expect(out[0]).toMatchObject({ minX: 400, maxX: 600, minY: 400, maxY: 500 });
  });

  it("keeps the first member's index as the anchor", () => {
    const out = clusterImpulses([imp(100, 500, 500, 1, 7), imp(200, 505, 505, 1, 9)], cfg);
    expect(out[0]?.anchorIndex).toBe(7);
  });
});

describe("mergeAndFilter", () => {
  it("drops clusters below the weight threshold", () => {
    const weak = clusterImpulses([imp(100, 500, 500, 0.3)], cfg);
    expect(mergeAndFilter(weak, cfg)).toEqual([]);
  });

  it("keeps clusters at or above the threshold", () => {
    const strong = clusterImpulses([imp(100, 500, 500, 1)], cfg);
    expect(mergeAndFilter(strong, cfg)).toHaveLength(1);
  });

  it("merges clusters separated by less than minGapMs before filtering", () => {
    // two weak far-apart-in-space clusters, 300ms apart: merge lets them qualify
    const cs = clusterImpulses([imp(100, 100, 100, 0.5), imp(400, 1500, 900, 0.5)], cfg);
    expect(cs).toHaveLength(2);
    const merged = mergeAndFilter(cs, cfg);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.weight).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/cluster.test.ts`
Expected: FAIL — cannot resolve `./cluster`.

- [ ] **Step 3: Write the implementation**

`src/shared/zoom/cluster.ts`:

```ts
import type { Cluster, Impulse, ZoomConfig } from "./types";

function absorb(c: Cluster, im: Impulse): void {
  const w = c.weight + im.w;
  c.cx = (c.cx * c.weight + im.x * im.w) / w;
  c.cy = (c.cy * c.weight + im.y * im.w) / w;
  c.weight = w;
  c.endT = Math.max(c.endT, im.t);
  c.minX = Math.min(c.minX, im.x);
  c.maxX = Math.max(c.maxX, im.x);
  c.minY = Math.min(c.minY, im.y);
  c.maxY = Math.max(c.maxY, im.y);
}

function absorbCluster(a: Cluster, b: Cluster): void {
  const w = a.weight + b.weight;
  a.cx = (a.cx * a.weight + b.cx * b.weight) / w;
  a.cy = (a.cy * a.weight + b.cy * b.weight) / w;
  a.weight = w;
  a.endT = Math.max(a.endT, b.endT);
  a.minX = Math.min(a.minX, b.minX);
  a.maxX = Math.max(a.maxX, b.maxX);
  a.minY = Math.min(a.minY, b.minY);
  a.maxY = Math.max(a.maxY, b.maxY);
}

export function clusterImpulses(imps: Impulse[], cfg: ZoomConfig): Cluster[] {
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;

  for (const im of imps) {
    const nearInTime = current !== null && im.t - current.endT <= cfg.clusterWindowMs;
    const nearInSpace =
      current !== null && Math.hypot(im.x - current.cx, im.y - current.cy) <= cfg.clusterRadiusPx;

    if (current !== null && nearInTime && nearInSpace) {
      absorb(current, im);
      continue;
    }

    current = {
      startT: im.t,
      endT: im.t,
      minX: im.x,
      maxX: im.x,
      minY: im.y,
      maxY: im.y,
      weight: im.w,
      cx: im.x,
      cy: im.y,
      anchorIndex: im.srcIndex,
    };
    clusters.push(current);
  }

  return clusters;
}

export function mergeAndFilter(cs: Cluster[], cfg: ZoomConfig): Cluster[] {
  const merged: Cluster[] = [];

  for (const c of cs) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && c.startT - prev.endT < cfg.minGapMs) {
      absorbCluster(prev, c);
      continue;
    }
    merged.push({ ...c });
  }

  return merged.filter((c) => c.weight >= cfg.minWeight);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom/cluster.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: spatial-temporal clustering of attention impulses"
```

---

## Task 8: Zoom guards

**Files:**
- Create: `src/shared/zoom/guards.ts`
- Test: `src/shared/zoom/guards.test.ts`

**Interfaces:**
- Consumes: `Cluster`, `ZoomConfig` from Task 6.
- Produces: `applyGuards(cs: Cluster[], cfg: ZoomConfig): Cluster[]`.

These three guards are the feature. Nearly all "seasick" auto-zoom is caused by transition *count*, not by bad anchor points.

- [ ] **Step 1: Write the failing test**

`src/shared/zoom/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { applyGuards } from "./guards";
import type { Cluster } from "./types";

const cfg = DEFAULT_ZOOM_CONFIG;

const cluster = (startT: number, endT: number, cx: number, cy: number, weight = 1): Cluster => ({
  startT, endT, cx, cy, weight,
  minX: cx - 50, maxX: cx + 50, minY: cy - 50, maxY: cy + 50,
  anchorIndex: startT,
});

describe("applyGuards", () => {
  it("keeps well-separated clusters", () => {
    const out = applyGuards([cluster(0, 100, 200, 200), cluster(5000, 5100, 1600, 900)], cfg);
    expect(out).toHaveLength(2);
  });

  it("merges a cluster inside the deadzone into the previous one", () => {
    // 60px apart, well inside deadzonePx 120
    const out = applyGuards([cluster(0, 100, 500, 500), cluster(5000, 5100, 560, 500)], cfg);
    expect(out).toHaveLength(1);
    expect(out[0]?.endT).toBe(5100);
  });

  it("merges a cluster that arrives before minHoldMs elapses", () => {
    // 800ms after the previous START, under minHoldMs 1500, though far away in space
    const out = applyGuards([cluster(0, 100, 200, 200), cluster(800, 900, 1600, 900)], cfg);
    expect(out).toHaveLength(1);
  });

  it("caps zooms per minute, keeping the heaviest", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [
        cluster(0, 10, 100, 100, 1),
        cluster(2000, 2010, 600, 100, 5),
        cluster(4000, 4010, 1100, 100, 3),
      ],
      tight,
    );
    expect(out.map((c) => c.weight)).toEqual([5, 3]);
  });

  it("returns rate-limited clusters in time order", () => {
    const tight = { ...cfg, maxZoomsPerMinute: 2, minHoldMs: 0, deadzonePx: 0 };
    const out = applyGuards(
      [
        cluster(4000, 4010, 1100, 100, 3),
        cluster(2000, 2010, 600, 100, 5),
      ].sort((a, b) => a.startT - b.startT),
      tight,
    );
    expect(out.map((c) => c.startT)).toEqual([2000, 4000]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/guards.test.ts`
Expected: FAIL — cannot resolve `./guards`.

- [ ] **Step 3: Write the implementation**

`src/shared/zoom/guards.ts`:

```ts
import type { Cluster, ZoomConfig } from "./types";

const MINUTE_MS = 60_000;

function absorbCluster(a: Cluster, b: Cluster): void {
  const w = a.weight + b.weight;
  a.cx = (a.cx * a.weight + b.cx * b.weight) / w;
  a.cy = (a.cy * a.weight + b.cy * b.weight) / w;
  a.weight = w;
  a.endT = Math.max(a.endT, b.endT);
  a.minX = Math.min(a.minX, b.minX);
  a.maxX = Math.max(a.maxX, b.maxX);
  a.minY = Math.min(a.minY, b.minY);
  a.maxY = Math.max(a.maxY, b.maxY);
}

function rateLimit(cs: Cluster[], maxPerMinute: number): Cluster[] {
  const buckets = new Map<number, Cluster[]>();
  for (const c of cs) {
    const key = Math.floor(c.startT / MINUTE_MS);
    const list = buckets.get(key);
    if (list === undefined) buckets.set(key, [c]);
    else list.push(c);
  }

  const kept: Cluster[] = [];
  for (const list of buckets.values()) {
    kept.push(...[...list].sort((a, b) => b.weight - a.weight).slice(0, maxPerMinute));
  }

  return kept.sort((a, b) => a.startT - b.startT);
}

export function applyGuards(cs: Cluster[], cfg: ZoomConfig): Cluster[] {
  const kept: Cluster[] = [];

  for (const c of cs) {
    const prev = kept[kept.length - 1];
    if (prev !== undefined) {
      const inDeadzone = Math.hypot(c.cx - prev.cx, c.cy - prev.cy) <= cfg.deadzonePx;
      const tooSoon = c.startT - prev.startT < cfg.minHoldMs;
      if (inDeadzone || tooSoon) {
        absorbCluster(prev, c);
        continue;
      }
    }
    kept.push({ ...c });
  }

  return rateLimit(kept, cfg.maxZoomsPerMinute);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom/guards.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: deadzone, min-hold and rate-limit guards on zoom clusters"
```

---

## Task 9: Zoom geometry and the planner

**Files:**
- Create: `src/shared/zoom/geometry.ts`, `src/shared/zoom/planner.ts`
- Test: `src/shared/zoom/geometry.test.ts`, `src/shared/zoom/planner.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3, 6, 7, 8.
- Produces:
  - `screenRect(source: Size, output: Size, paddingFactor: number): Rect`
  - `maxComfortableZoom(source: Size, output: Size, paddingFactor: number): number`
  - `fitScale(c: Cluster, cfg: ZoomConfig, ctx: PlanContext): number`
  - `planZoom(events: TelemetryEvent[], cfg: ZoomConfig, ctx: PlanContext): ZoomKeyframe[]`

`maxComfortableZoom` is spec §8: the 1080p limitation encoded as a formula rather than a constant, so a higher-resolution source lifts the ceiling with no code change.

- [ ] **Step 1: Write the failing geometry test**

`src/shared/zoom/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { fitScale, maxComfortableZoom, screenRect } from "./geometry";
import type { Cluster, PlanContext } from "./types";

const HD = { w: 1920, h: 1080 };
const UHD = { w: 3840, h: 2160 };

describe("screenRect", () => {
  it("insets by the padding factor and centres", () => {
    const r = screenRect(HD, HD, 0.85);
    expect(r.w).toBeCloseTo(1632, 5);
    expect(r.h).toBeCloseTo(918, 5);
    expect(r.x).toBeCloseTo(144, 5);
    expect(r.y).toBeCloseTo(81, 5);
  });

  it("fits by height when the source is wider than the output", () => {
    const r = screenRect({ w: 3840, h: 1080 }, HD, 1);
    expect(r.w).toBeCloseTo(1920, 5);
    expect(r.h).toBeCloseTo(540, 5);
  });
});

describe("maxComfortableZoom", () => {
  it("gives ~1.18x of free zoom on a 1080p source", () => {
    expect(maxComfortableZoom(HD, HD, 0.85)).toBeCloseTo(1.176, 3);
  });

  it("doubles when the source is 4K", () => {
    expect(maxComfortableZoom(UHD, HD, 0.85)).toBeCloseTo(2.353, 3);
  });

  it("is exactly 1 with no padding on a matched source", () => {
    expect(maxComfortableZoom(HD, HD, 1)).toBeCloseTo(1, 6);
  });
});

describe("fitScale", () => {
  const ctx: PlanContext = { source: HD, output: HD, paddingFactor: 0.85 };
  const cluster = (halfW: number): Cluster => ({
    startT: 0, endT: 0, cx: 960, cy: 540, weight: 1, anchorIndex: 0,
    minX: 960 - halfW, maxX: 960 + halfW, minY: 490, maxY: 590,
  });

  it("clamps to the comfortable maximum for a tight cluster", () => {
    expect(fitScale(cluster(5), DEFAULT_ZOOM_CONFIG, ctx)).toBeCloseTo(1.176, 3);
  });

  it("never returns less than 1", () => {
    expect(fitScale(cluster(5000), DEFAULT_ZOOM_CONFIG, ctx)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Write the geometry implementation**

`src/shared/zoom/geometry.ts`:

```ts
import type { Cluster, PlanContext, Size, ZoomConfig } from "./types";

export type Rect = { x: number; y: number; w: number; h: number };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The screen quad at zoom 1: source aspect, inset by paddingFactor, centred. */
export function screenRect(source: Size, output: Size, paddingFactor: number): Rect {
  const maxW = output.w * paddingFactor;
  const maxH = output.h * paddingFactor;
  const aspect = source.w / source.h;

  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }

  return { x: (output.w - w) / 2, y: (output.h - h) / 2, w, h };
}

/**
 * The zoom level at which one source pixel maps to one output pixel.
 * Above this, the export is upscaling and softens.
 */
export function maxComfortableZoom(source: Size, output: Size, paddingFactor: number): number {
  return source.w / screenRect(source, output, paddingFactor).w;
}

export function fitScale(c: Cluster, cfg: ZoomConfig, ctx: PlanContext): number {
  const boundsW = c.maxX - c.minX + cfg.marginPx * 2;
  const boundsH = c.maxY - c.minY + cfg.marginPx * 2;
  const desired = Math.min(
    ctx.source.w / Math.max(boundsW, 1),
    ctx.source.h / Math.max(boundsH, 1),
  );
  return clamp(desired, 1, maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor));
}
```

- [ ] **Step 4: Run the geometry test**

Run: `npx vitest run src/shared/zoom/geometry.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing planner test**

`src/shared/zoom/planner.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTelemetry } from "../bundle/telemetry";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { planZoom } from "./planner";
import type { PlanContext } from "./types";

const ctx: PlanContext = {
  source: { w: 1920, h: 1080 },
  output: { w: 1920, h: 1080 },
  paddingFactor: 0.85,
};

describe("planZoom", () => {
  it("returns nothing for empty telemetry", () => {
    expect(planZoom([], DEFAULT_ZOOM_CONFIG, ctx)).toEqual([]);
  });

  it("emits an in/out keyframe pair per surviving cluster", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs).toHaveLength(2);
    expect(kfs[0]?.scale).toBeGreaterThan(1);
    expect(kfs[1]?.scale).toBe(1);
  });

  it("leads the zoom in and trails it out", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 500, y: 400, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.tSourceMs).toBe(750); // 1000 - leadInMs 250
    expect(kfs[1]?.tSourceMs).toBe(1400); // 1000 + trailMs 400
  });

  it("never leads in before zero", () => {
    const kfs = planZoom([{ t: 10, k: "down", x: 500, y: 400, b: 1 }], DEFAULT_ZOOM_CONFIG, ctx);
    expect(kfs[0]?.tSourceMs).toBe(0);
  });

  it("normalises the focus point to 0..1 of the source", () => {
    const kfs = planZoom(
      [{ t: 1000, k: "down", x: 960, y: 540, b: 1 }],
      DEFAULT_ZOOM_CONFIG,
      ctx,
    );
    expect(kfs[0]?.cx).toBeCloseTo(0.5, 6);
    expect(kfs[0]?.cy).toBeCloseTo(0.5, 6);
  });

  it("marks generated keyframes as auto and unpinned with stable ids", () => {
    const a = planZoom([{ t: 1000, k: "down", x: 500, y: 400, b: 1 }], DEFAULT_ZOOM_CONFIG, ctx);
    const b = planZoom([{ t: 1000, k: "down", x: 500, y: 400, b: 1 }], DEFAULT_ZOOM_CONFIG, ctx);
    expect(a[0]?.origin).toBe("auto");
    expect(a[0]?.pinned).toBe(false);
    expect(a.map((k) => k.id)).toEqual(b.map((k) => k.id));
  });

  it("returns keyframes in time order", () => {
    const text = readFileSync(
      join(process.cwd(), "tests", "fixtures", "basic", "input.jsonl"),
      "utf8",
    );
    const kfs = planZoom(parseTelemetry(text), DEFAULT_ZOOM_CONFIG, ctx);
    const times = kfs.map((k) => k.tSourceMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(kfs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/planner.test.ts`
Expected: FAIL — cannot resolve `./planner`.

- [ ] **Step 7: Write the planner implementation**

`src/shared/zoom/planner.ts`:

```ts
import type { TelemetryEvent } from "../bundle/types";
import { clusterImpulses, mergeAndFilter } from "./cluster";
import { fitScale } from "./geometry";
import { applyGuards } from "./guards";
import { toImpulses } from "./impulses";
import type { PlanContext, ZoomConfig, ZoomKeyframe } from "./types";

export function planZoom(
  events: TelemetryEvent[],
  cfg: ZoomConfig,
  ctx: PlanContext,
): ZoomKeyframe[] {
  const clusters = applyGuards(
    mergeAndFilter(clusterImpulses(toImpulses(events, cfg), cfg), cfg),
    cfg,
  );

  const kfs: ZoomKeyframe[] = [];

  for (const c of clusters) {
    const scale = fitScale(c, cfg, ctx);
    if (scale <= 1.0001) continue;

    const cx = c.cx / ctx.source.w;
    const cy = c.cy / ctx.source.h;

    kfs.push({
      id: `k${c.anchorIndex}i`,
      tSourceMs: Math.max(0, c.startT - cfg.leadInMs),
      scale,
      cx,
      cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });

    kfs.push({
      id: `k${c.anchorIndex}o`,
      tSourceMs: c.endT + cfg.trailMs,
      scale: 1,
      cx,
      cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionMs,
      origin: "auto",
      pinned: false,
    });
  }

  return kfs.sort((a, b) => a.tSourceMs - b.tSourceMs);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom`
Expected: PASS — all zoom tests green.

- [ ] **Step 9: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: zoom geometry and keyframe planner"
```

---

## Task 10: Easing and zoom interpolation

**Files:**
- Create: `src/shared/zoom/easing.ts`, `src/shared/zoom/interpolate.ts`
- Test: `src/shared/zoom/easing.test.ts`, `src/shared/zoom/interpolate.test.ts`

**Interfaces:**
- Consumes: `ZoomKeyframe`, `EasingName` from Task 6.
- Produces: `cubicBezier(x1,y1,x2,y2): (x: number) => number`, `EASINGS: Record<EasingName, (x: number) => number>`, `type ZoomState = { scale, cx, cy }`, `NO_ZOOM`, `zoomAt(kfs: ZoomKeyframe[], tMs: number): ZoomState`.

The timing model: a keyframe's `transitionMs` is the transition *into* it. Between two keyframes the earlier value holds until `next.tSourceMs - next.transitionMs`, then eases to the next.

- [ ] **Step 1: Write the failing easing test**

`src/shared/zoom/easing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EASINGS, cubicBezier } from "./easing";

describe("cubicBezier", () => {
  const ease = cubicBezier(0.33, 0, 0.1, 1);

  it("pins the endpoints", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("clamps out-of-range input", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("is monotonically increasing", () => {
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.05) {
      const y = ease(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it("front-loads the motion (ease-out)", () => {
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });
});

describe("EASINGS", () => {
  it("exposes linear as an identity", () => {
    expect(EASINGS.linear(0.42)).toBeCloseTo(0.42, 6);
  });

  it("exposes zoomEase", () => {
    expect(EASINGS.zoomEase(1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/easing.test.ts`
Expected: FAIL — cannot resolve `./easing`.

- [ ] **Step 3: Write the easing implementation**

`src/shared/zoom/easing.ts`:

```ts
import type { EasingName } from "./types";

/** Standard CSS cubic-bezier solver: Newton-Raphson on x, then evaluate y. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const a = (p1: number, p2: number): number => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number): number => 3 * p2 - 6 * p1;
  const c = (p1: number): number => 3 * p1;

  const curve = (t: number, p1: number, p2: number): number =>
    ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number): number =>
    3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;

    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(t, x1, x2);
      if (d === 0) break;
      t -= (curve(t, x1, x2) - x) / d;
    }

    return curve(t, y1, y2);
  };
}

export const EASINGS: Record<EasingName, (x: number) => number> = {
  zoomEase: cubicBezier(0.33, 0, 0.1, 1),
  linear: (x: number): number => Math.min(1, Math.max(0, x)),
};
```

- [ ] **Step 4: Run the easing test**

Run: `npx vitest run src/shared/zoom/easing.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing interpolation test**

`src/shared/zoom/interpolate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NO_ZOOM, zoomAt } from "./interpolate";
import type { ZoomKeyframe } from "./types";

const kf = (tSourceMs: number, scale: number): ZoomKeyframe => ({
  id: `k${tSourceMs}`,
  tSourceMs,
  scale,
  cx: 0.25,
  cy: 0.75,
  easing: "linear",
  transitionMs: 600,
  origin: "auto",
  pinned: false,
});

describe("zoomAt", () => {
  it("returns no zoom for an empty keyframe list", () => {
    expect(zoomAt([], 1000)).toEqual(NO_ZOOM);
  });

  it("returns no zoom before the first transition begins", () => {
    expect(zoomAt([kf(1000, 2)], 100)).toEqual(NO_ZOOM);
  });

  it("returns the keyframe value at its own time", () => {
    const s = zoomAt([kf(1000, 2)], 1000);
    expect(s.scale).toBeCloseTo(2, 6);
    expect(s.cx).toBeCloseTo(0.25, 6);
  });

  it("holds the last keyframe value afterwards", () => {
    expect(zoomAt([kf(1000, 2)], 99_999).scale).toBeCloseTo(2, 6);
  });

  it("interpolates through the transition", () => {
    // linear easing, midpoint of a 600ms transition into scale 2 from 1
    const s = zoomAt([kf(1000, 2)], 700);
    expect(s.scale).toBeGreaterThan(1);
    expect(s.scale).toBeLessThan(2);
    expect(s.scale).toBeCloseTo(1.5, 2);
  });

  it("eases between two keyframes", () => {
    const kfs = [kf(1000, 2), kf(3000, 1)];
    expect(zoomAt(kfs, 2000).scale).toBeCloseTo(2, 6); // holding
    expect(zoomAt(kfs, 3000).scale).toBeCloseTo(1, 6); // arrived
    const mid = zoomAt(kfs, 2700).scale;
    expect(mid).toBeLessThan(2);
    expect(mid).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/interpolate.test.ts`
Expected: FAIL — cannot resolve `./interpolate`.

- [ ] **Step 7: Write the interpolation implementation**

`src/shared/zoom/interpolate.ts`:

```ts
import { EASINGS } from "./easing";
import type { ZoomKeyframe } from "./types";

export type ZoomState = { scale: number; cx: number; cy: number };

export const NO_ZOOM: ZoomState = { scale: 1, cx: 0.5, cy: 0.5 };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function zoomAt(kfs: ZoomKeyframe[], tMs: number): ZoomState {
  if (kfs.length === 0) return NO_ZOOM;

  let prev: ZoomState = NO_ZOOM;

  for (const k of kfs) {
    if (tMs >= k.tSourceMs) {
      prev = { scale: k.scale, cx: k.cx, cy: k.cy };
      continue;
    }

    const transitionStart = k.tSourceMs - k.transitionMs;
    if (tMs <= transitionStart) return prev;

    const u = (tMs - transitionStart) / k.transitionMs;
    const e = EASINGS[k.easing](u);
    return {
      scale: lerp(prev.scale, k.scale, e),
      cx: lerp(prev.cx, k.cx, e),
      cy: lerp(prev.cy, k.cy, e),
    };
  }

  return prev;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom/interpolate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: cubic-bezier easing and zoom state interpolation"
```

---

## Task 11: Re-planning with pinned keyframes

**Files:**
- Create: `src/shared/zoom/replan.ts`
- Test: `src/shared/zoom/replan.test.ts`

**Interfaces:**
- Consumes: `ZoomKeyframe` from Task 6.
- Produces: `replan(existing: ZoomKeyframe[], generated: ZoomKeyframe[]): ZoomKeyframe[]`.

This is what makes the tuning loop work — spec §7. Curve improvements apply retroactively to old projects without destroying per-clip fixes.

- [ ] **Step 1: Write the failing test**

`src/shared/zoom/replan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { replan } from "./replan";
import type { ZoomKeyframe } from "./types";

const kf = (over: Partial<ZoomKeyframe> & { id: string }): ZoomKeyframe => ({
  tSourceMs: 1000,
  scale: 1.5,
  cx: 0.5,
  cy: 0.5,
  easing: "zoomEase",
  transitionMs: 600,
  origin: "auto",
  pinned: false,
  ...over,
});

describe("replan", () => {
  it("replaces unpinned auto keyframes wholesale", () => {
    const out = replan([kf({ id: "k1i", scale: 1.5 })], [kf({ id: "k1i", scale: 1.9 })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.scale).toBe(1.9);
  });

  it("keeps a pinned keyframe and drops the generated one with the same id", () => {
    const out = replan(
      [kf({ id: "k1i", scale: 1.2, pinned: true })],
      [kf({ id: "k1i", scale: 1.9 })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.scale).toBe(1.2);
    expect(out[0]?.pinned).toBe(true);
  });

  it("keeps manual keyframes even when unpinned", () => {
    const out = replan([kf({ id: "m1", origin: "manual" })], []);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("m1");
  });

  it("adds newly generated keyframes alongside pinned ones", () => {
    const out = replan(
      [kf({ id: "k1i", pinned: true })],
      [kf({ id: "k1i" }), kf({ id: "k2i", tSourceMs: 4000 })],
    );
    expect(out.map((k) => k.id)).toEqual(["k1i", "k2i"]);
  });

  it("returns keyframes in time order", () => {
    const out = replan(
      [kf({ id: "p", tSourceMs: 5000, pinned: true })],
      [kf({ id: "g", tSourceMs: 100 })],
    );
    expect(out.map((k) => k.tSourceMs)).toEqual([100, 5000]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/zoom/replan.test.ts`
Expected: FAIL — cannot resolve `./replan`.

- [ ] **Step 3: Write the implementation**

`src/shared/zoom/replan.ts`:

```ts
import type { ZoomKeyframe } from "./types";

/**
 * Merge a fresh plan into an existing one, preserving user intent.
 * A keyframe survives re-planning if the user pinned it or authored it.
 */
export function replan(
  existing: ZoomKeyframe[],
  generated: ZoomKeyframe[],
): ZoomKeyframe[] {
  const keep = existing.filter((k) => k.pinned || k.origin === "manual");
  const keptIds = new Set(keep.map((k) => k.id));
  const fresh = generated.filter((k) => !keptIds.has(k.id));

  return [...keep, ...fresh].sort((a, b) => a.tSourceMs - b.tSourceMs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/zoom/replan.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/zoom
git commit -m "feat: re-plan merge preserving pinned and manual keyframes"
```

---

## Task 12: Project types and cut normalisation

**Files:**
- Create: `src/shared/project/types.ts`, `src/shared/project/defaults.ts`, `src/shared/project/cuts.ts`
- Test: `src/shared/project/cuts.test.ts`

**Interfaces:**
- Consumes: `ZoomConfig`, `ZoomKeyframe` from Task 6.
- Produces: `type Cut = { startMs: number; endMs: number }`, `type Project`, `DEFAULT_PROJECT`, `normalizeCuts(cuts: Cut[], durationMs: number): Cut[]`.

Every timeline function normalises first, so the mapping functions in Task 13 can assume sorted, non-overlapping, in-range cuts.

- [ ] **Step 1: Write the failing test**

`src/shared/project/cuts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeCuts } from "./cuts";

describe("normalizeCuts", () => {
  it("sorts by start time", () => {
    const out = normalizeCuts([{ startMs: 500, endMs: 600 }, { startMs: 100, endMs: 200 }], 1000);
    expect(out.map((c) => c.startMs)).toEqual([100, 500]);
  });

  it("merges overlapping cuts", () => {
    const out = normalizeCuts([{ startMs: 100, endMs: 400 }, { startMs: 300, endMs: 600 }], 1000);
    expect(out).toEqual([{ startMs: 100, endMs: 600 }]);
  });

  it("merges exactly touching cuts", () => {
    const out = normalizeCuts([{ startMs: 100, endMs: 300 }, { startMs: 300, endMs: 500 }], 1000);
    expect(out).toEqual([{ startMs: 100, endMs: 500 }]);
  });

  it("repairs reversed bounds", () => {
    expect(normalizeCuts([{ startMs: 600, endMs: 200 }], 1000)).toEqual([
      { startMs: 200, endMs: 600 },
    ]);
  });

  it("clamps to the recording duration", () => {
    expect(normalizeCuts([{ startMs: -100, endMs: 5000 }], 1000)).toEqual([
      { startMs: 0, endMs: 1000 },
    ]);
  });

  it("drops zero-length cuts", () => {
    expect(normalizeCuts([{ startMs: 300, endMs: 300 }], 1000)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [{ startMs: 600, endMs: 200 }];
    normalizeCuts(input, 1000);
    expect(input).toEqual([{ startMs: 600, endMs: 200 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/project/cuts.test.ts`
Expected: FAIL — cannot resolve `./cuts`.

- [ ] **Step 3: Write the implementation**

`src/shared/project/types.ts`:

```ts
import type { ZoomConfig, ZoomKeyframe } from "../zoom/types";

export type Cut = { startMs: number; endMs: number };

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number };

export type StyleConfig = {
  paddingFactor: number;
  cornerRadiusPx: number;
  shadow: { blurPx: number; opacity: number; offsetYPx: number };
  background: Background;
};

export type WebcamConfig = {
  visible: boolean;
  shape: "circle" | "rounded";
  sizePct: number;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  marginPx: number;
};

export type OutputConfig = {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
};

export type Project = {
  version: 1;
  bundleId: string;
  cuts: Cut[];
  zoom: { config: ZoomConfig; keyframes: ZoomKeyframe[] };
  style: StyleConfig;
  webcam: WebcamConfig;
  audio: { micGainDb: number; systemGainDb: number; syncNudgeMs: number };
  output: OutputConfig;
};
```

`src/shared/project/defaults.ts`:

```ts
import { DEFAULT_ZOOM_CONFIG } from "../zoom/config";
import type { Project } from "./types";

export function defaultProject(bundleId: string): Project {
  return {
    version: 1,
    bundleId,
    cuts: [],
    zoom: { config: { ...DEFAULT_ZOOM_CONFIG }, keyframes: [] },
    style: {
      paddingFactor: 0.85,
      cornerRadiusPx: 12,
      shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
      background: { kind: "gradient", from: "#1b1d23", to: "#0d0e11", angle: 135 },
    },
    webcam: {
      visible: true,
      shape: "circle",
      sizePct: 18,
      position: "bottom-right",
      marginPx: 32,
    },
    audio: { micGainDb: 0, systemGainDb: -6, syncNudgeMs: 0 },
    output: { width: 1920, height: 1080, fps: 60, bitrateMbps: 12 },
  };
}
```

`src/shared/project/cuts.ts`:

```ts
import type { Cut } from "./types";

/** Sort, repair, clamp and merge cuts so downstream code can assume they are clean. */
export function normalizeCuts(cuts: Cut[], durationMs: number): Cut[] {
  const cleaned = cuts
    .map((c) => ({
      startMs: Math.max(0, Math.min(c.startMs, c.endMs)),
      endMs: Math.min(durationMs, Math.max(c.startMs, c.endMs)),
    }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const out: Cut[] = [];
  for (const c of cleaned) {
    const last = out[out.length - 1];
    if (last !== undefined && c.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, c.endMs);
      continue;
    }
    out.push({ ...c });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/project/cuts.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/project
git commit -m "feat: project document types and cut normalisation"
```

---

## Task 13: Timeline mapping with property tests

**Files:**
- Create: `src/shared/project/timeline.ts`
- Test: `src/shared/project/timeline.test.ts`

**Interfaces:**
- Consumes: `Cut`, `normalizeCuts` from Task 12.
- Produces:
  - `outputDurationMs(durationMs: number, cuts: Cut[]): number`
  - `sourceToOutput(tSource: number, durationMs: number, cuts: Cut[]): number | null`
  - `outputToSource(tOutput: number, durationMs: number, cuts: Cut[]): number`

Spec §9 names this the highest-risk module in the project. It gets property tests as well as examples.

- [ ] **Step 1: Write the failing test**

`src/shared/project/timeline.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeCuts } from "./cuts";
import { outputDurationMs, outputToSource, sourceToOutput } from "./timeline";
import type { Cut } from "./types";

const DURATION = 10_000;
const CUTS: Cut[] = [{ startMs: 4200, endMs: 7100 }];

describe("timeline — examples", () => {
  it("shortens the output by the total cut length", () => {
    expect(outputDurationMs(DURATION, CUTS)).toBe(7100);
  });

  it("is identity with no cuts", () => {
    expect(sourceToOutput(5000, DURATION, [])).toBe(5000);
    expect(outputToSource(5000, DURATION, [])).toBe(5000);
  });

  it("maps source before a cut unchanged", () => {
    expect(sourceToOutput(4199, DURATION, CUTS)).toBe(4199);
  });

  it("returns null for a source time inside a cut", () => {
    expect(sourceToOutput(5000, DURATION, CUTS)).toBeNull();
  });

  it("shifts source after a cut left by the cut length", () => {
    expect(sourceToOutput(7100, DURATION, CUTS)).toBe(4200);
    expect(sourceToOutput(9000, DURATION, CUTS)).toBe(6100);
  });

  it("skips the cut when mapping output back to source", () => {
    expect(outputToSource(4199, DURATION, CUTS)).toBe(4199);
    expect(outputToSource(4200, DURATION, CUTS)).toBe(7100);
  });
});

const arbCuts = fc
  .array(
    fc.tuple(fc.integer({ min: 0, max: DURATION }), fc.integer({ min: 0, max: DURATION })),
    { maxLength: 6 },
  )
  .map((pairs) => pairs.map(([a, b]) => ({ startMs: a, endMs: b })));

describe("timeline — properties", () => {
  it("outputDuration equals duration minus the sum of normalised cuts", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const removed = normalizeCuts(cuts, DURATION).reduce(
          (s, c) => s + (c.endMs - c.startMs),
          0,
        );
        expect(outputDurationMs(DURATION, cuts)).toBe(DURATION - removed);
      }),
    );
  });

  it("outputToSource is monotonically non-decreasing", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const outDur = outputDurationMs(DURATION, cuts);
        let prev = -1;
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          expect(s).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }),
    );
  });

  it("round-trips every output time back to itself", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const outDur = outputDurationMs(DURATION, cuts);
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          expect(sourceToOutput(s, DURATION, cuts)).toBe(t);
        }
      }),
    );
  });

  it("never maps an output time into a cut region", () => {
    fc.assert(
      fc.property(arbCuts, (cuts) => {
        const norm = normalizeCuts(cuts, DURATION);
        const outDur = outputDurationMs(DURATION, cuts);
        for (let t = 0; t < outDur; t += 97) {
          const s = outputToSource(t, DURATION, cuts);
          for (const c of norm) {
            expect(s >= c.startMs && s < c.endMs).toBe(false);
          }
        }
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/project/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Write the implementation**

`src/shared/project/timeline.ts`:

```ts
import { normalizeCuts } from "./cuts";
import type { Cut } from "./types";

export function outputDurationMs(durationMs: number, cuts: Cut[]): number {
  const removed = normalizeCuts(cuts, durationMs).reduce(
    (sum, c) => sum + (c.endMs - c.startMs),
    0,
  );
  return durationMs - removed;
}

/** Source position → output position, or null when the source time was cut. */
export function sourceToOutput(
  tSource: number,
  durationMs: number,
  cuts: Cut[],
): number | null {
  let removed = 0;

  for (const c of normalizeCuts(cuts, durationMs)) {
    if (tSource >= c.endMs) {
      removed += c.endMs - c.startMs;
      continue;
    }
    if (tSource >= c.startMs) return null;
    break;
  }

  return tSource - removed;
}

/** Output position → source position. Total: every output time has a source. */
export function outputToSource(
  tOutput: number,
  durationMs: number,
  cuts: Cut[],
): number {
  let t = tOutput;

  for (const c of normalizeCuts(cuts, durationMs)) {
    if (t >= c.startMs) {
      t += c.endMs - c.startMs;
      continue;
    }
    break;
  }

  return t;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/project/timeline.test.ts`
Expected: PASS — 6 example tests and 4 properties.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/project
git commit -m "feat: ripple-cut timeline mapping with property tests"
```

---

## Task 14: Renderer layout

**Files:**
- Create: `src/renderer/gl/layout.ts`
- Test: `src/renderer/gl/layout.test.ts`

**Interfaces:**
- Consumes: `screenRect`, `clamp` from Task 9; `ZoomState` from Task 10.
- Produces: `screenQuad(source: Size, output: Size, paddingFactor: number, zoom: ZoomState): Rect`.

The zoom model: scale about the focus point, then pull the focus point toward the output centre by `k = 1 - 1/scale`. That factor is 0 at scale 1 — so the quad reduces exactly to `screenRect` with no discontinuity — and approaches 1 as scale grows, so a deep zoom centres its subject.

Note this file lives under `src/renderer/` but is pure and unit-tested; only `Renderer.ts` touches WebGL.

- [ ] **Step 1: Write the failing test**

`src/renderer/gl/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { screenRect } from "../../shared/zoom/geometry";
import { NO_ZOOM } from "../../shared/zoom/interpolate";
import { screenQuad } from "./layout";

const HD = { w: 1920, h: 1080 };
const PAD = 0.85;

describe("screenQuad", () => {
  it("reduces exactly to screenRect at scale 1", () => {
    expect(screenQuad(HD, HD, PAD, NO_ZOOM)).toEqual(screenRect(HD, HD, PAD));
  });

  it("is continuous just above scale 1", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 1.0001, cx: 0.2, cy: 0.2 });
    expect(q.x).toBeCloseTo(base.x, 0);
    expect(q.y).toBeCloseTo(base.y, 0);
  });

  it("scales the quad by the zoom factor", () => {
    const base = screenRect(HD, HD, PAD);
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeCloseTo(base.w * 2, 5);
    expect(q.h).toBeCloseTo(base.h * 2, 5);
  });

  it("centres a centred focus point", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 2, cx: 0.5, cy: 0.5 });
    expect(q.x + q.w / 2).toBeCloseTo(HD.w / 2, 5);
    expect(q.y + q.h / 2).toBeCloseTo(HD.h / 2, 5);
  });

  it("clamps so an oversized quad never exposes background at an edge", () => {
    // focus hard left; quad is wider than the output, so x must not go positive
    const q = screenQuad(HD, HD, PAD, { scale: 3, cx: 0, cy: 0.5 });
    expect(q.w).toBeGreaterThan(HD.w);
    expect(q.x).toBeLessThanOrEqual(0);
    expect(q.x + q.w).toBeGreaterThanOrEqual(HD.w);
  });

  it("keeps padding visible when the quad is still smaller than the output", () => {
    const q = screenQuad(HD, HD, PAD, { scale: 1.1, cx: 0.5, cy: 0.5 });
    expect(q.w).toBeLessThan(HD.w);
    expect(q.x).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/gl/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Write the implementation**

`src/renderer/gl/layout.ts`:

```ts
import { clamp, screenRect, type Rect } from "../../shared/zoom/geometry";
import type { ZoomState } from "../../shared/zoom/interpolate";
import type { Size } from "../../shared/zoom/types";

/**
 * Place the screen quad in output space for a given zoom state.
 *
 * Scale about the focus point, then pull the focus toward the output centre by
 * k = 1 - 1/scale. k is 0 at scale 1, so this reduces exactly to screenRect and
 * has no discontinuity when a zoom begins.
 */
export function screenQuad(
  source: Size,
  output: Size,
  paddingFactor: number,
  zoom: ZoomState,
): Rect {
  const base = screenRect(source, output, paddingFactor);

  const w = base.w * zoom.scale;
  const h = base.h * zoom.scale;

  const focusX = base.x + zoom.cx * base.w;
  const focusY = base.y + zoom.cy * base.h;

  const k = 1 - 1 / zoom.scale;

  let x = focusX - zoom.cx * w + (output.w / 2 - focusX) * k;
  let y = focusY - zoom.cy * h + (output.h / 2 - focusY) * k;

  if (w >= output.w) x = clamp(x, output.w - w, 0);
  if (h >= output.h) y = clamp(y, output.h - h, 0);

  return { x, y, w, h };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/gl/layout.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/gl
git commit -m "feat: screen quad layout with continuous focus-to-centre zoom"
```

---

## Task 15: WebGL2 compositor

**Files:**
- Create: `src/renderer/gl/shaders.ts`, `src/renderer/gl/Renderer.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `screenQuad` from Task 14, `StyleConfig` from Task 12, `ZoomState` from Task 10.
- Produces:
  ```ts
  type FrameState = {
    screen: TexImageSource;
    webcam?: TexImageSource;
    zoom: ZoomState;
    style: StyleConfig;
    outputSize: Size;
    sourceSize: Size;
  };
  class Renderer {
    constructor(canvas: HTMLCanvasElement);
    drawFrame(state: FrameState): void;
    dispose(): void;
  }
  ```

This task is verified by eye, not by assertion — spec §14 explicitly declines GPU snapshot tests as flaky across driver updates, and a wrong frame is immediately visible.

- [ ] **Step 1: Write the shader source**

`src/renderer/gl/shaders.ts`:

```ts
export const QUAD_VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform vec4 u_rect;      // x, y, w, h in clip-space-normalised output coords
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SCREEN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2  u_quadPx;
uniform float u_radiusPx;
uniform float u_sharpen;
uniform vec2  u_texel;
out vec4 frag;

float roundedRectAlpha(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - (halfSize - vec2(r));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  return 1.0 - smoothstep(-1.0, 1.0, d);
}

void main() {
  vec3 c = texture(u_tex, v_uv).rgb;

  if (u_sharpen > 0.0) {
    vec3 blur = texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb
              + texture(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb;
    c = clamp(c + u_sharpen * (c - blur * 0.25), 0.0, 1.0);
  }

  vec2 p = (v_uv - 0.5) * u_quadPx;
  frag = vec4(c, roundedRectAlpha(p, u_quadPx * 0.5, u_radiusPx));
}`;

export const BG_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3  u_from;
uniform vec3  u_to;
uniform float u_angle;
out vec4 frag;
void main() {
  vec2 dir = vec2(cos(u_angle), sin(u_angle));
  float t = clamp(dot(v_uv - 0.5, dir) + 0.5, 0.0, 1.0);
  frag = vec4(mix(u_from, u_to, t), 1.0);
}`;
```

- [ ] **Step 2: Implement the Renderer**

Write `src/renderer/gl/Renderer.ts` implementing the interface above. Required behaviour, in draw order:

1. Resize the canvas backing store to `outputSize` and set the viewport.
2. Draw the background quad full-frame using `BG_FRAG`.
3. Compute `rect = screenQuad(sourceSize, outputSize, style.paddingFactor, zoom)`.
4. Upload `state.screen` into a texture with `LINEAR` filtering and `CLAMP_TO_EDGE` wrapping.
5. Compute `sharpen`: `0` when `rect.w <= sourceSize.w`, otherwise `min(0.6, rect.w / sourceSize.w - 1)`.
6. Draw the screen quad with `SCREEN_FRAG`, `u_quadPx = [rect.w, rect.h]`, `u_radiusPx = style.cornerRadiusPx`, alpha blending enabled (`SRC_ALPHA, ONE_MINUS_SRC_ALPHA`).
7. Webcam and cursor passes are stubbed in this task — Tasks in phases 8 and 9 fill them in.

Cache the program, VAO and texture objects on the instance. Do not create GL objects inside `drawFrame` — it runs 60 times a second in preview and once per frame during export.

- [ ] **Step 3: Wire a visual harness into App.tsx**

Render a `<canvas>`, construct a `Renderer`, and draw a single frame using a solid-colour `ImageBitmap` (via `createImageBitmap(new ImageData(...))`) as the screen source, with a hardcoded `zoom` of `{ scale: 1, cx: 0.5, cy: 0.5 }`. Add three buttons setting `scale` to 1, 1.18 and 3 so the layout behaviour is inspectable.

- [ ] **Step 4: Verify by eye**

```powershell
npm run dev
```

Acceptance criteria, all of which must hold:

- At scale 1 the coloured rectangle is centred with visible background padding on all four sides and visibly rounded corners.
- At scale 1.18 the rectangle is larger, still centred, still shows padding.
- At scale 3 the rectangle fills the frame edge to edge with **no** background visible, and no corner rounding is apparent (the corners are off-screen).
- Dragging the window to resize does not distort the aspect ratio.
- No WebGL errors in the devtools console.

- [ ] **Step 5: Commit**

```powershell
git add src/renderer
git commit -m "feat: webgl2 compositor with styled frame and adaptive sharpen"
```

---

## Task 16: Video decode source

**Files:**
- Create: `src/renderer/media/VideoSource.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `Manifest` from Task 2.
- Produces:
  ```ts
  class VideoSource {
    static open(fileUrl: string): Promise<VideoSource>;
    readonly durationMs: number;
    frameAt(tMs: number): Promise<VideoFrame>;
    close(): void;
  }
  ```

`frameAt` must return the frame whose presentation time is the greatest one `<= tMs`. Implementation: mp4box.js demuxes to encoded chunks; seeking decodes from the nearest preceding keyframe. With GOP 30 that is at most 30 frames of decode, which is why Q6 chose that GOP.

- [ ] **Step 1: Implement VideoSource**

Required behaviour:

1. Fetch the file as an `ArrayBuffer`, feed it to `MP4Box.createFile()`, and read the `avcC` description to build the `VideoDecoder` config.
2. Build a sample index: for every sample, record `{ cts, duration, isSync, byteOffset }`.
3. `frameAt(tMs)`: find the target sample, walk back to the nearest `isSync` sample, `decoder.reset()` if seeking backwards or more than one GOP forward, then feed chunks until the decoder outputs a frame with `timestamp >= target`. Return that frame; close every earlier frame.
4. Maintain a one-frame cache so scrubbing forward within a GOP does not re-decode.

Callers **must** call `.close()` on returned `VideoFrame`s. A leaked `VideoFrame` stalls the decoder within a few seconds — if preview freezes after roughly 60 frames, this is the cause.

- [ ] **Step 2: Wire it into the visual harness**

In `App.tsx`, load `tests/fixtures/basic/screen.mp4`, add a range input over `0..durationMs`, and draw `frameAt(t)` through the `Renderer` from Task 15.

- [ ] **Step 3: Verify by eye**

```powershell
npm run dev
```

Acceptance criteria:

- Dragging the slider shows the `testsrc2` pattern updating, with its built-in frame counter advancing monotonically.
- Seeking backwards works and shows the correct earlier frame.
- Scrubbing continuously for 30 seconds does not freeze — if it does, a `VideoFrame` is being leaked.
- The frame at `t = 0` and the frame at `t = 4999` are visibly different.

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/media
git commit -m "feat: mp4box + webcodecs video source with keyframe-accurate seek"
```

---

## Task 17: Editor shell

**Files:**
- Create: `src/main/bundleIo.ts`, `src/main/ipc.ts`, `src/renderer/media/PreviewPlayer.ts`, `src/renderer/ui/Timeline.tsx`, `src/renderer/ui/Inspector.tsx`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–14.
- Produces: an IPC surface `window.zoomcast.openBundle(dir): Promise<{ manifest: Manifest; telemetry: TelemetryEvent[]; project: Project }>` and `window.zoomcast.saveProject(dir, project): Promise<void>`.

- [ ] **Step 1: Implement bundle IO in main**

`bundleIo.ts` reads `manifest.json` through `parseManifest`, reads `input.jsonl` through `parseTelemetry`, and reads `project.json` if present or creates one via `defaultProject(manifest.id)` if not. Writing is `JSON.stringify(project, null, 2)`.

This is the only module allowed to touch the filesystem for bundles. `src/shared/` stays pure.

- [ ] **Step 2: Wire the IPC surface**

Expose exactly the two methods above through `contextBridge`. No `ipcRenderer` leaks into the renderer.

- [ ] **Step 3: Build the editor UI**

- On load, call `planZoom(telemetry, project.zoom.config, ctx)` and merge with `replan` against `project.zoom.keyframes`.
- `PreviewPlayer` drives `Renderer.drawFrame` on `requestAnimationFrame`, computing `zoomAt(keyframes, outputToSource(playheadMs, durationMs, cuts))`.
- `Timeline.tsx` shows the output-time ruler, keyframe markers, and a marker style distinguishing keyframes whose `scale` exceeds `maxComfortableZoom(...)` — spec §8 requires the 1:1 crossing be visible.
- `Inspector.tsx` edits `ZoomConfig` and triggers a re-plan on change.

- [ ] **Step 4: Verify by eye**

Acceptance criteria against `tests/fixtures/basic`:

- The `basic` fixture yields exactly **one** zoom, in at `t≈155` and out at `t≈4005`, scale 1.176, focus near `(0.665, 0.645)`. This is correct, not a bug: `minHoldMs` 1500 means a 5-second clip cannot support more than about three zooms, and the fixture's three clicks plus typing burst all fall inside one hold window. Verified empirically at Task 9.
- Because of that, `basic` is a poor harness for *watching the planner make decisions*. Generate a second fixture (`tests/fixtures/spread`, ~30s with clicks 4–6s apart in distinct screen regions) before tuning curves by eye. The generator already takes the event list as data; only the constants change.
- Playback zooms in and out smoothly with no visible snapping at transition boundaries.
- Changing `minHoldMs` in the inspector visibly changes the number of keyframes.
- Editing a keyframe's scale marks it pinned, and a subsequent config change leaves that keyframe alone.
- Since the fixture source is 1080p, every generated keyframe should sit at or just under 1.176 and none should be flagged as crossing 1:1.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: editor shell with live re-planning and preview playback"
```

---

## Task 18: Export frame plan

**Files:**
- Create: `src/shared/export/exportPlan.ts`
- Test: `src/shared/export/exportPlan.test.ts`

**Interfaces:**
- Consumes: `outputDurationMs`, `outputToSource` from Task 13.
- Produces: `type ExportFrame = { index: number; tOutputMs: number; tSourceMs: number }` and `planExportFrames(durationMs: number, cuts: Cut[], fps: number): ExportFrame[]`.

- [ ] **Step 1: Write the failing test**

`src/shared/export/exportPlan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Cut } from "../project/types";
import { planExportFrames } from "./exportPlan";

describe("planExportFrames", () => {
  it("emits fps frames per second with no cuts", () => {
    expect(planExportFrames(1000, [], 60)).toHaveLength(60);
  });

  it("starts at output time zero mapping to source zero", () => {
    const f = planExportFrames(1000, [], 60)[0];
    expect(f).toEqual({ index: 0, tOutputMs: 0, tSourceMs: 0 });
  });

  it("shortens the frame count by the cut length", () => {
    const cuts: Cut[] = [{ startMs: 200, endMs: 400 }];
    expect(planExportFrames(1000, cuts, 60)).toHaveLength(48); // 800ms at 60fps
  });

  it("skips over the cut in source time", () => {
    const cuts: Cut[] = [{ startMs: 200, endMs: 400 }];
    const frames = planExportFrames(1000, cuts, 60);
    const atCut = frames.find((f) => f.tOutputMs === 200);
    expect(atCut?.tSourceMs).toBe(400);
  });

  it("never emits a source time inside a cut", () => {
    const cuts: Cut[] = [{ startMs: 200, endMs: 400 }];
    for (const f of planExportFrames(1000, cuts, 60)) {
      expect(f.tSourceMs >= 200 && f.tSourceMs < 400).toBe(false);
    }
  });

  it("numbers frames consecutively from zero", () => {
    const frames = planExportFrames(500, [], 30);
    expect(frames.map((f) => f.index)).toEqual(frames.map((_, i) => i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/export/exportPlan.test.ts`
Expected: FAIL — cannot resolve `./exportPlan`.

- [ ] **Step 3: Write the implementation**

`src/shared/export/exportPlan.ts`:

```ts
import { outputDurationMs, outputToSource } from "../project/timeline";
import type { Cut } from "../project/types";

export type ExportFrame = {
  index: number;
  tOutputMs: number;
  tSourceMs: number;
};

export function planExportFrames(
  durationMs: number,
  cuts: Cut[],
  fps: number,
): ExportFrame[] {
  const outMs = outputDurationMs(durationMs, cuts);
  const count = Math.floor((outMs * fps) / 1000);
  const frames: ExportFrame[] = [];

  for (let index = 0; index < count; index++) {
    const tOutputMs = (index * 1000) / fps;
    frames.push({
      index,
      tOutputMs,
      tSourceMs: outputToSource(tOutputMs, durationMs, cuts),
    });
  }

  return frames;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/export/exportPlan.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/export
git commit -m "feat: export frame plan mapping output frames to source times"
```

---

## Task 19: ffmpeg argument builder

**Files:**
- Create: `src/shared/export/ffmpegArgs.ts`
- Test: `src/shared/export/ffmpegArgs.test.ts`

**Interfaces:**
- Consumes: `normalizeCuts` from Task 12, `Cut` from Task 12.
- Produces:
  ```ts
  type AudioInput = { file: string; gainDb: number; startOffsetMs: number };
  type ExportArgsOptions = {
    width: number; height: number; fps: number;
    bitrateMbps: number; encoder: string;
    durationMs: number; cuts: Cut[];
    audio: AudioInput[]; syncNudgeMs: number; outFile: string;
  };
  buildExportArgs(o: ExportArgsOptions): string[];
  ```

Two subtleties this module exists to get right:

- **`-itsoffset` places each audio input on the source timeline**, so the `atrim` filters can then work in plain source time. Delay is `(startOffsetMs - syncNudgeMs) / 1000` — the same convention as Task 4.
- **`asplit` is mandatory** before multiple `atrim`s on one input. A filter output pad may be consumed only once, so `[1:a]` cannot feed three `atrim`s directly; it must be split first.

- [ ] **Step 1: Write the failing test**

`src/shared/export/ffmpegArgs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildExportArgs } from "./ffmpegArgs";

const base = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateMbps: 12,
  encoder: "h264_amf",
  durationMs: 5000,
  cuts: [],
  audio: [{ file: "mic.webm", gainDb: 0, startOffsetMs: 142 }],
  syncNudgeMs: 0,
  outFile: "out.mp4",
};

const joined = (o: Parameters<typeof buildExportArgs>[0]): string =>
  buildExportArgs(o).join(" ");

describe("buildExportArgs", () => {
  it("declares the rawvideo pipe input first", () => {
    const args = buildExportArgs(base);
    expect(args.slice(0, 12)).toEqual([
      "-y", "-hide_banner",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", "1920x1080",
      "-r", "60",
      "-i", "pipe:0",
    ]);
  });

  it("places each audio input on the source timeline with itsoffset", () => {
    expect(joined(base)).toContain("-itsoffset 0.142 -i mic.webm");
  });

  it("subtracts the sync nudge from the offset", () => {
    expect(joined({ ...base, syncNudgeMs: 42 })).toContain("-itsoffset 0.1 -i mic.webm");
  });

  it("uses no asplit or concat when there are no cuts", () => {
    const s = joined(base);
    expect(s).not.toContain("asplit");
    expect(s).not.toContain("concat");
    expect(s).toContain("volume=0dB");
  });

  it("splits and concatenates one segment per kept span", () => {
    const s = joined({ ...base, cuts: [{ startMs: 1000, endMs: 2000 }] });
    expect(s).toContain("asplit=2");
    expect(s).toContain("concat=n=2:v=0:a=1");
    expect(s).toContain("atrim=start=0:end=1");
    expect(s).toContain("atrim=start=2");
  });

  it("produces three segments for two cuts", () => {
    const s = joined({
      ...base,
      cuts: [{ startMs: 1000, endMs: 2000 }, { startMs: 3000, endMs: 3500 }],
    });
    expect(s).toContain("asplit=3");
    expect(s).toContain("concat=n=3:v=0:a=1");
  });

  it("mixes two audio inputs", () => {
    const s = joined({
      ...base,
      audio: [
        { file: "mic.webm", gainDb: 0, startOffsetMs: 142 },
        { file: "system.webm", gainDb: -6, startOffsetMs: 138 },
      ],
    });
    expect(s).toContain("amix=inputs=2:duration=longest:normalize=0");
    expect(s).toContain("volume=-6dB");
  });

  it("omits audio entirely when there are no audio inputs", () => {
    const s = joined({ ...base, audio: [] });
    expect(s).not.toContain("-filter_complex");
    expect(s).not.toContain("-c:a");
  });

  it("sets the video encoder, bitrate and output pixel format", () => {
    const s = joined(base);
    expect(s).toContain("-c:v h264_amf");
    expect(s).toContain("-b:v 12M");
    expect(s).toContain("-pix_fmt yuv420p");
    expect(buildExportArgs(base).at(-1)).toBe("out.mp4");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/export/ffmpegArgs.test.ts`
Expected: FAIL — cannot resolve `./ffmpegArgs`.

- [ ] **Step 3: Write the implementation**

`src/shared/export/ffmpegArgs.ts`:

```ts
import { normalizeCuts } from "../project/cuts";
import type { Cut } from "../project/types";

export type AudioInput = {
  file: string;
  gainDb: number;
  startOffsetMs: number;
};

export type ExportArgsOptions = {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  encoder: string;
  durationMs: number;
  cuts: Cut[];
  audio: AudioInput[];
  syncNudgeMs: number;
  outFile: string;
};

/** The spans of source time that survive the cuts, in seconds. */
function keptSpans(durationMs: number, cuts: Cut[]): Array<[number, number | null]> {
  const norm = normalizeCuts(cuts, durationMs);
  const spans: Array<[number, number | null]> = [];
  let cursor = 0;

  for (const c of norm) {
    if (c.startMs > cursor) spans.push([cursor / 1000, c.startMs / 1000]);
    cursor = c.endMs;
  }

  spans.push([cursor / 1000, null]); // to end of input
  return spans;
}

function audioChain(
  inputIndex: number,
  a: AudioInput,
  spans: Array<[number, number | null]>,
  label: string,
): string[] {
  const parts: string[] = [];
  const src = `${inputIndex}:a`;

  if (spans.length === 1) {
    parts.push(`[${src}]volume=${a.gainDb}dB[${label}]`);
    return parts;
  }

  const splitLabels = spans.map((_, i) => `${label}s${i}`);
  parts.push(`[${src}]asplit=${spans.length}${splitLabels.map((l) => `[${l}]`).join("")}`);

  const trimLabels = spans.map((_, i) => `${label}t${i}`);
  spans.forEach(([start, end], i) => {
    const trim = end === null ? `atrim=start=${start}` : `atrim=start=${start}:end=${end}`;
    parts.push(`[${splitLabels[i]}]${trim},asetpts=PTS-STARTPTS[${trimLabels[i]}]`);
  });

  parts.push(
    `${trimLabels.map((l) => `[${l}]`).join("")}concat=n=${spans.length}:v=0:a=1[${label}c]`,
  );
  parts.push(`[${label}c]volume=${a.gainDb}dB[${label}]`);

  return parts;
}

export function buildExportArgs(o: ExportArgsOptions): string[] {
  const args: string[] = [
    "-y", "-hide_banner",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${o.width}x${o.height}`,
    "-r", String(o.fps),
    "-i", "pipe:0",
  ];

  o.audio.forEach((a) => {
    const delaySec = (a.startOffsetMs - o.syncNudgeMs) / 1000;
    args.push("-itsoffset", String(delaySec), "-i", a.file);
  });

  if (o.audio.length > 0) {
    const spans = keptSpans(o.durationMs, o.cuts);
    const graph: string[] = [];
    const labels: string[] = [];

    o.audio.forEach((a, i) => {
      const label = `a${i}`;
      graph.push(...audioChain(i + 1, a, spans, label));
      labels.push(`[${label}]`);
    });

    if (o.audio.length > 1) {
      graph.push(
        `${labels.join("")}amix=inputs=${o.audio.length}:duration=longest:normalize=0[aout]`,
      );
    } else {
      graph.push(`${labels[0]}anull[aout]`);
    }

    args.push("-filter_complex", graph.join(";"));
    args.push("-map", "0:v", "-map", "[aout]");
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-map", "0:v");
  }

  args.push(
    "-c:v", o.encoder,
    "-b:v", `${o.bitrateMbps}M`,
    "-pix_fmt", "yuv420p",
    o.outFile,
  );

  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/export/ffmpegArgs.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/export
git commit -m "feat: ffmpeg export argument builder with cut-aware audio graph"
```

---

## Task 20: Export driver and end-to-end test

**Files:**
- Create: `src/main/exportRunner.ts`, `src/main/ffmpeg.ts`, `tests/e2e/export.e2e.test.ts`
- Modify: `src/main/ipc.ts`, `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `buildExportArgs` (Task 19), `planExportFrames` (Task 18), `Renderer` (Task 15), `VideoSource` (Task 16).
- Produces: `resolveFfmpeg(): Promise<string>`, `probeEncoders(bin: string): Promise<string[]>`, and `runExport(opts, frameSource): Promise<void>`.

The e2e test deliberately bypasses WebGL. It feeds synthetic RGBA buffers through the real `buildExportArgs` into the real ffmpeg against the real fixture audio, then verifies the output with ffprobe. That exercises the half of the export that fails silently — argument construction, the audio graph, backpressure, stream alignment — in an environment vitest can actually run.

- [ ] **Step 1: Implement ffmpeg resolution**

`src/main/ffmpeg.ts`: `resolveFfmpeg()` returns the `ffmpegPath` setting if set, otherwise resolves `ffmpeg` from PATH. `probeEncoders(bin)` runs `-hide_banner -encoders` and returns the encoder names found. A helper `assertCapable(bin)` runs `-filters` and throws naming the resolved path if `ddagrab` is absent — spec §13.

- [ ] **Step 2: Implement the export runner**

`runExport(opts, frameSource)` spawns ffmpeg with `buildExportArgs(opts)`, then for each `ExportFrame` awaits `frameSource(frame)` returning a `Uint8Array` of `width * height * 4` bytes and writes it to `stdin`.

Backpressure is mandatory:

```ts
if (!child.stdin.write(buf)) {
  await new Promise<void>((resolve) => child.stdin.once("drain", resolve));
}
```

Skipping this buffers the entire export in memory — roughly 8MB per frame at 1080p, so a one-minute export would try to hold about 30GB. End with `child.stdin.end()` and resolve on a zero exit code, rejecting with the collected stderr otherwise.

- [ ] **Step 3: Write the end-to-end test**

`tests/e2e/export.e2e.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planExportFrames } from "../../src/shared/export/exportPlan";
import { runExport } from "../../src/main/exportRunner";

const FIXTURE = join(process.cwd(), "tests", "fixtures", "basic");
const TMP = join(process.cwd(), "tmp");
const OUT = join(TMP, "e2e-export.mp4");

const probe = (file: string, entries: string, stream: string): string =>
  execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "csv=p=0", file],
    { encoding: "utf8" },
  ).trim();

describe("export end to end", () => {
  it("produces a playable mp4 with video and mixed audio", async () => {
    mkdirSync(TMP, { recursive: true });
    rmSync(OUT, { force: true });

    const durationMs = 5000;
    const cuts = [{ startMs: 1000, endMs: 2000 }];
    const fps = 30;
    const width = 320;
    const height = 180;
    const frames = planExportFrames(durationMs, cuts, fps);

    await runExport(
      {
        width, height, fps,
        bitrateMbps: 2,
        encoder: "libx264",
        durationMs,
        cuts,
        audio: [
          { file: join(FIXTURE, "mic.webm"), gainDb: 0, startOffsetMs: 142 },
          { file: join(FIXTURE, "system.webm"), gainDb: -6, startOffsetMs: 138 },
        ],
        syncNudgeMs: 0,
        outFile: OUT,
      },
      frames,
      (frame) => {
        // a solid colour ramp keyed off the frame index, so the file is not empty
        const buf = new Uint8Array(width * height * 4);
        buf.fill(Math.floor((frame.index / frames.length) * 255));
        return Promise.resolve(buf);
      },
    );

    expect(existsSync(OUT)).toBe(true);

    // 4000ms of output at 30fps = 120 frames
    expect(frames).toHaveLength(120);
    expect(Number(probe(OUT, "stream=nb_read_frames", "v:0"))).toBeGreaterThan(0);

    const duration = Number(probe(OUT, "format=duration", "v:0"));
    expect(duration).toBeGreaterThan(3.8);
    expect(duration).toBeLessThan(4.3);

    expect(probe(OUT, "stream=codec_name", "a:0")).toBe("aac");
  }, 120_000);
});
```

Note the `runExport` signature this test pins down: `(opts, frames, frameSource) => Promise<void>`, where `frameSource(frame: ExportFrame) => Promise<Uint8Array>`. Implement Step 2 to match.

- [ ] **Step 4: Run the end-to-end test**

Run: `npx vitest run tests/e2e/export.e2e.test.ts`
Expected: PASS. If ffmpeg reports a filtergraph error, the fault is almost certainly in `audioChain` — print `buildExportArgs(...).join(" ")` and run it by hand to see ffmpeg's own diagnosis.

- [ ] **Step 5: Wire real export into the UI**

Add an "Export" button that calls the IPC method, passing a `frameSource` that draws through the `Renderer` from Task 15 and reads back with `gl.readPixels` into a `Uint8Array`.

Note the flip: WebGL's origin is bottom-left, rawvideo expects top-left. Either render with an inverted projection or reverse the row order before writing. If the exported video is upside down, this is why.

- [ ] **Step 6: Verify the first real clip**

```powershell
npm run dev
```

Open `tests/fixtures/basic`, let the planner run, add one cut, export.

Acceptance criteria:

- The exported MP4 plays in any player.
- Its zooms match what the preview showed, at the same times — this is the payoff of the shared-renderer decision, and if it fails here, preview and export have diverged and that is a design-level bug, not a detail.
- The cut region is absent and audio remains in sync across the cut.
- The video is right way up.

- [ ] **Step 7: Run the whole suite and commit**

```powershell
npm test
npm run typecheck
git add -A
git commit -m "feat: export driver, end-to-end test, and first real clip out of the tool"
```

---

## Phases 6–9 (sketch)

Not planned in detail — they will look different once the editor exists, and planning them now would be guessing. Each gets its own plan document when its turn comes.

**Phase 6 — Screen capture.** `ScreenSource` spawning ffmpeg with `ddagrab=output_idx=0:draw_mouse=0:framerate=60`, encoder selected by `probeEncoders`, `-g 30 -movflags +frag_keyframe+empty_moov`. `TelemetryRecorder` wrapping `uiohook-napi` with a 250ms flush. Tray icon, global hotkey, 3-2-1 countdown, and a border overlay using `setContentProtection(true)` so it stays out of the capture. Manifest assembly and the `status: "unclean"` path on abnormal ffmpeg exit. Verified by recording, then opening the result in the phase-5 editor — which already works.

**Phase 7 — Audio.** `getUserMedia` for mic, `desktopCapturer` with `chromeMediaSource: 'desktop'` for system loopback, `MediaRecorder` to disk, first-sample wall-clock stamping into `startOffsetMs`. Sync nudge slider wired to `syncNudgeMs`. Highest-risk item in the phase is measuring MediaRecorder's true first-sample time rather than its start-call time.

**Phase 8 — Webcam PiP.** Third `MediaRecorder`, a second `VideoSource` in the editor, the webcam pass in `Renderer`, and placement UI. The export path needs a second decode running in lockstep with the screen decode.

**Phase 9 — Polish.** Cursor shape capture via `koffi` calling `user32!GetCursorInfo` at 30Hz, ~8 SVG cursor shapes, click ripple tuning, the recordings library view with per-bundle sizes and "delete source bundle" after export.

---

## Self-Review

**Spec coverage.** §4 architecture → Tasks 1, 15, 17, 20. §5 bundle format → Tasks 2, 3, 5. §6 modules → Tasks 2–20 (`capture/` is phase 6). §7 zoom planner including config table and re-planning → Tasks 6–11. §8 zoom quality and the derived ceiling → Task 9 (`maxComfortableZoom`), surfaced in the UI in Task 17. §9 timeline and `project.json` → Tasks 12, 13. §10 renderer → Tasks 14, 15. §11 A/V sync → Task 4 and Task 19's `-itsoffset`. §12 export → Tasks 18, 19, 20. §13 error handling → Task 3 (truncated telemetry), Task 20 (ffmpeg capability check and stderr surfacing); the remaining rows are capture-side and belong to phases 6–8. §14 testing → golden/property/e2e across Tasks 9, 13, 20. §15 build order → task order. §16 dependencies → Task 1. §17 storage → phase 9. §18 deferred → untouched, correctly.

**Known gaps, deliberate.** The webcam and cursor render passes are stubbed in Task 15 and completed in phases 8–9; the `Renderer` interface already carries `webcam` so adding them is not a rewrite. Undo/redo is not in phases 0–5 — spec §6 specifies immutable project snapshots, which is a Task-17-adjacent addition once the editor's shape settles.

**Type consistency check.** `Size` and `PlanContext` are defined once in `src/shared/zoom/types.ts` and imported everywhere. `Rect` is defined once in `geometry.ts` and re-used by `layout.ts`. `Cut` is defined once in `project/types.ts`. `ZoomState` is defined in `interpolate.ts` and consumed by `layout.ts` and `Renderer.ts`. `toStreamLocalMs` (Task 4) and the `-itsoffset` computation (Task 19) use the same sign convention, stated in Global Constraints. `runExport`'s signature is pinned by the Task 20 test before Step 2 implements it.
