# Review Round 1 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six verified bugs from the 2026-09-26 review and give the repo a lint gate and CI, on top of `phase-e-timeline-editing`.

**Architecture:** Each bug is fixed at the seam that owns it, with a unit test in the pure layer where one exists (`src/shared`, `src/main/capture`'s arg builders, `src/renderer/media`'s plain state machines). The one fix with no pure seam — the preview media clock, currently an inline object in `Editor.tsx` — gets one: a `createMediaClock` factory in `src/renderer/media/mediaClock.ts` that converts between output and source time and is tested against a fake element. Infrastructure lands last so it gates the fixes rather than the other way round.

**Tech Stack:** TypeScript 7, vitest 5, Electron 44, ffmpeg (external), Biome 2.5.14, GitHub Actions on `windows-latest`.

**Spec:** `docs/superpowers/notes/2026-09-26-codebase-review.md` (findings V1–V6 and the infrastructure gaps).

## Global Constraints

- Base branch: `phase-e-timeline-editing`; work on `review-round-1` branched from it. Do not touch `main`.
- `src/shared/` stays pure: no electron, DOM or fs imports.
- Preview and export call the same `Renderer`; do not add a second draw path.
- Any change to rendering or export: rebuild, then `npm run verify:parity` on Windows.
- Media times compare in integer ticks or ms, never float seconds, in `src/shared`.
- No `any`, no `@ts-ignore`. `npm run typecheck` must stay silent.
- Where to run what:
  - The pure suite runs in WSL: `cd /home/amour/projects/zoomcast && npm test`. `node_modules` is installed there (node v24.4.1).
  - Anything needing Electron, ffmpeg or a GPU runs in the Windows clone `C:\dev\zoomcast`, whose `origin` is the WSL repo. Sync it with:
    `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; git fetch origin <branch>; git checkout <branch>; git reset --hard origin/<branch>"`
    then run commands with the user PATH loaded (winget's ffmpeg is not on a fresh shell's PATH):
    `powershell.exe -NoProfile -Command '$env:Path = [Environment]::GetEnvironmentVariable("Path","User") + ";" + [Environment]::GetEnvironmentVariable("Path","Machine"); cd C:\dev\zoomcast; <command>'`
- Do not run `npm run tune -- all` as a gate here: no takes exist on this machine's `%LOCALAPPDATA%\zoomcast\recordings`.

## Review Focus

1. A source time exactly on a cut's start (`mediaTime === cut.startMs`) is inside the cut and must skip the element to the cut's end, not report `cut.startMs` as an output time — pinned in Task 7.
2. A cut that runs to the end of the take: the element plays into it and stops; without a report the player stays `playing` forever — pinned in Task 7 (the clock reports the output duration so the player pauses).
3. A follow segment ending at the take's end must not sample past `ctx.durationMs` once sampling extends to the pull-out — pinned in Task 5.
4. `-vf` alongside `-filter_complex`: the video is mapped straight from input 0 and must stay out of the complex graph, or ffmpeg rejects the command when audio is present — pinned in Task 6 (unit test) and exercised end to end by `tests/e2e` on Windows.
5. `h264_amf` may not write VUI colour into the bitstream even when tagged; the e2e test probes `color_space` per available encoder so the dev machine (which has AMF) proves it — pinned in Task 6, with the bitstream-filter fallback written out.

---

### Task 1: `npm test` skips the e2e export when ffmpeg is absent

**Files:**
- Modify: `tests/e2e/export.e2e.test.ts:36-51, 101-102`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a green `npm test` in WSL (no ffmpeg), which every later task relies on.

- [ ] **Step 1: See the current failure in WSL**

Run: `cd /home/amour/projects/zoomcast && npx vitest run tests/e2e`
Expected: FAIL — `Error: spawnSync ffmpeg ENOENT` at `availableEncoders`.

- [ ] **Step 2: Make `availableEncoders` return `[]` without ffmpeg and skip the suite**

Replace lines 36–51 (the `availableEncoders` doc comment, function, and the `describe.each` line) with:

```ts
/**
 * The encoders ffmpeg on this machine can actually use.
 *
 * The export button hardcodes h264_amf and every automated check hardcoded
 * libx264, so the encoder users actually get was the one nothing had ever
 * tested — the same shape as phase A shipping five broken cursor shapes
 * because the fixture emitted no cursor events.
 *
 * Empty when ffmpeg is not on PATH: the suite below is then skipped rather
 * than failing at collection, so `npm test` still means something on a
 * machine (or CI runner) without ffmpeg.
 */
function availableEncoders(): string[] {
  let listed: string;
  try {
    listed = execFileSync("ffmpeg", ["-v", "error", "-encoders"], {
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  return ["libx264", "h264_amf"].filter((e) => listed.includes(e));
}

const encoders = availableEncoders();

describe.skipIf(encoders.length === 0)("export end to end", () => {
  it.each(encoders)("produces a playable mp4 with video and mixed, cut-aware audio (%s)", async (encoder) => {
```

The body of the test is unchanged. The closing lines stay `}, 120_000);` and `});`.

- [ ] **Step 3: Enable the transform cache**

In `vitest.config.ts`, the `test` block becomes:

```ts
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Transforms were 60-70% of every run. The cache lives in node_modules so
    // a reinstall invalidates it.
    fsModuleCache: true,
  },
```

- [ ] **Step 4: Run the whole suite in WSL**

Run: `npm test`
Expected: `Test Files  1 skipped | 50 passed (51)` and `Tests  519 passed`. No failures. (The e2e file holds the two encoder tests; on Windows with ffmpeg it is `521 passed`.)

If vitest instead reports `No test suite found in file` for the e2e file, an empty skipped `describe` does not count as a suite in this version. Register one skipped test explicitly: replace the `describe.skipIf(...)` / `it.each(encoders)` pair with

```ts
describe.each(encoders.length === 0 ? [null] : encoders)("export end to end (%s)", (encoder) => {
  it.skipIf(encoder === null)("produces a playable mp4 with video and mixed, cut-aware audio", async () => {
    if (encoder === null) return;
```

and keep the body unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/export.e2e.test.ts vitest.config.ts
git commit -m "test: skip the e2e export when ffmpeg is not on PATH; cache transforms"
```

---

### Task 2: Tray "Quit" quits

**Files:**
- Modify: `src/main/recording.ts:177-184`

**Interfaces:**
- Consumes: `app` from `electron`, and the existing `before-quit` handler in `src/main/index.ts:558-569`, which already calls `abortRecording()` on every quit path and then `app.exit(code)`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Confirm the bug in the source**

Run: `grep -n "app.quit\|app.exit" src/main/recording.ts src/main/index.ts`
Expected: no `app.quit` in `recording.ts`; the only `app.quit()` calls in `index.ts` are the five headless harness exits (lines ~232–434) and `app.exit` in `before-quit`.

- [ ] **Step 2: Replace the Quit handler**

`recording.ts` lines 177–184 currently read:

```ts
      {
        label: "Quit",
        click: () => {
          void abortRecording().finally(() => {
            for (const win of BrowserWindow.getAllWindows()) win.destroy();
          });
        },
      },
```

Replace with:

```ts
      {
        label: "Quit",
        // One quit path. `before-quit` in index.ts finishes any take and then
        // calls app.exit; destroying the windows here without quitting left
        // the process, the tray and the hotkey alive after "Quit".
        click: () => app.quit(),
      },
```

If `app` is not already imported in `recording.ts`, add it to the existing `from "electron"` import. If `BrowserWindow` is now unused in the file, remove it from that import (typecheck will not complain, Biome in Task 8 will).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: silent.

- [ ] **Step 4: Hand-check on Windows**

Sync the Windows clone (Global Constraints), then:

```powershell
cd C:\dev\zoomcast; npm run build; Start-Process npx -ArgumentList "electron","." 
```

Ask the user to click the tray icon → **Quit**. Then:

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
```

Expected: `0`. Before the fix it stays at 3–4.

- [ ] **Step 5: Commit**

```bash
git add src/main/recording.ts
git commit -m "fix: tray Quit actually quits the process"
```

---

### Task 3: Capture stamps t=0 within a frame, not within half a second

**Files:**
- Modify: `src/main/capture/ScreenSource.ts:69-77` (the `common` args) and the `firstFrame` promise near line 293
- Test: `src/main/capture/captureArgs.test.ts`

**Interfaces:**
- Consumes: `buildCaptureArgs(backend: CaptureBackend, opts: ScreenCaptureOptions): string[]` (exists).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

Append to `src/main/capture/captureArgs.test.ts`:

```ts
describe("buildCaptureArgs — clock anchor", () => {
  /**
   * start() stamps t=0 for telemetry and audio when the first -progress block
   * arrives. At ffmpeg's default 0.5s report period that anchor landed up to
   * 500ms after the real first frame, and every event inherited the bias.
   */
  it.each(["ddagrab", "gdigrab"] as const)(
    "asks for progress every 20ms on %s, so the first frame is stamped within a frame or two",
    (backend) => {
      const args = buildCaptureArgs(backend, opts);
      expect(args[args.indexOf("-stats_period") + 1]).toBe("0.02");
    },
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/capture/captureArgs.test.ts`
Expected: 2 failures — `expected undefined to be '0.02'`.

- [ ] **Step 3: Add the flag**

In `ScreenSource.ts`, the `common` array (line ~69) becomes:

```ts
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    // The first progress block is what timestamps t=0 for telemetry and
    // audio (see start()). At the default 0.5s period that anchor landed up
    // to 500ms late; 20ms keeps it within a frame or two of the real first
    // frame. The match below stays `frame >= 1` because at 30fps the first
    // block can still say frame=0.
    "-stats_period",
    "0.02",
    "-nostats",
  ];
```

Then find the `firstFrame` promise (`const firstFrame = new Promise<number>(`, ~line 293) and add this comment directly above it:

```ts
    // Wall-clock time of the first captured frame, as near as ffmpeg lets us
    // observe it: the first -progress block reporting frame >= 1. With
    // -stats_period 0.02 that is within ~20ms plus one frame.
```

- [ ] **Step 4: Run the capture tests**

Run: `npx vitest run src/main/capture`
Expected: all pass, including the two new ones.

- [ ] **Step 5: Verify capture still runs on Windows**

Sync the Windows clone, then with the user PATH loaded: `npm run verify:capture`
Expected: `PASS: ddagrab at ~55-58fps`. (This proves the new flag does not upset the ddagrab chain.)

- [ ] **Step 6: Commit**

```bash
git add src/main/capture/ScreenSource.ts src/main/capture/captureArgs.test.ts
git commit -m "fix: report capture progress every 20ms so the clock anchor is not up to 500ms late"
```

---

### Task 4: The curve picker offers the default curve

**Files:**
- Create: `src/shared/zoom/curves.ts`
- Create: `src/shared/zoom/curves.test.ts`
- Modify: `src/renderer/ui/Inspector.tsx:1-9` (imports) and `:64-73` (delete the local `CURVES`)

**Interfaces:**
- Consumes: `EasingName` from `src/shared/zoom/types.ts`; `DEFAULT_ZOOM_CONFIG.easing` from `config.ts` (currently `"cameraZoom"`).
- Produces: `export const CURVES: ReadonlyArray<{ value: EasingName; label: string }>`.

- [ ] **Step 1: Write the failing test**

`src/shared/zoom/curves.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import { CURVES } from "./curves";

describe("CURVES", () => {
  /**
   * A <select> whose value is not among its options renders the first option
   * and turns every change into a one-way trip: the default curve could be
   * left but never returned to.
   */
  it("offers the default curve, so the picker can show it and return to it", () => {
    expect(CURVES.map((c) => c.value)).toContain(DEFAULT_ZOOM_CONFIG.easing);
  });

  it("never offers the mechanisms", () => {
    const offered = CURVES.map((c) => c.value);
    expect(offered).not.toContain("linear");
    expect(offered).not.toContain("cameraPan");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/shared/zoom/curves.test.ts`
Expected: FAIL — cannot resolve `./curves`.

- [ ] **Step 3: Create the module**

`src/shared/zoom/curves.ts`:

```ts
import type { EasingName } from "./types";

/**
 * The curves the inspector offers, in the order it shows them.
 *
 * `cameraZoom` first: it is the default, and a picker that cannot show the
 * default renders the first option instead and turns every change into a
 * one-way trip. `linear` and `cameraPan` are deliberately absent — they are
 * mechanisms (the follow sampler's ramp, the in-shot pan), not looks anyone
 * would choose for a zoom. See easing.ts for what each curve measured as.
 */
export const CURVES: ReadonlyArray<{ value: EasingName; label: string }> = [
  { value: "cameraZoom", label: "camera — eases in and out, settles slowly" },
  { value: "screenStudio", label: "studio — commits, then settles" },
  { value: "zoomGlide", label: "glide — even, peaks mid-move" },
  { value: "zoomEase", label: "ease — fast in, drifting tail" },
];
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/zoom/curves.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Point the inspector at it**

In `Inspector.tsx`, delete lines 64–73 (the comment starting `/**\n * The curves worth offering.` and the `const CURVES = [...]` array). Add to the imports:

```ts
import { CURVES } from "../../shared/zoom/curves";
```

The `<select>` at line ~138 and its `CURVES.map` are unchanged.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: silent typecheck; `521 passed` in WSL.

- [ ] **Step 7: Commit**

```bash
git add src/shared/zoom/curves.ts src/shared/zoom/curves.test.ts src/renderer/ui/Inspector.tsx
git commit -m "fix: offer the default cameraZoom curve in the inspector's picker"
```

---

### Task 5: The follow camera keeps following until the pull-out begins

**Files:**
- Modify: `src/shared/zoom/keyframes.ts:147-183` (call site) and `:207-238` (`sampleFollow`)
- Test: `src/shared/zoom/keyframes.test.ts` (the `describe("a follow segment")` block, line 192)

**Interfaces:**
- Consumes: `segmentsToKeyframes(segments, cfg, ctx, path)`, `FOLLOW_SAMPLE_MS` (exported, = 100), the test file's `seg()`, `OUT_SHIFT`, `cfg`.
- Produces: `sampleFollow(path, last, fromMs, outMs, s, cfg, ctx, ceiling)` — private; the new fourth parameter is the out-keyframe's time.

- [ ] **Step 1: Write the failing tests**

Add `FOLLOW_SAMPLE_MS` to the existing import from `./keyframes` at the top of `keyframes.test.ts`:

```ts
import { FOLLOW_SAMPLE_MS, depthToScale, scaleToDepth, segmentsToKeyframes } from "./keyframes";
```

Inside `describe("a follow segment", ...)`, after the test `"pulls out so the transition begins at the segment's end"`, add:

```ts
  /**
   * Sampling used to stop at endMs - transitionOutMs, but the out-keyframe
   * sits at endMs + (transitionOutMs - trailMs), so the pull-out actually
   * starts at endMs - trailMs. The camera sat frozen on its last sample for
   * the 600ms in between, before every exit from a follow shot.
   */
  it("keeps following until the pull-out begins, not until the segment ends", () => {
    const kfs = segmentsToKeyframes([seg5], cfg, square, path);
    const samples = kfs.filter((k) => k.id.includes("f"));
    const lastSample = samples[samples.length - 1];
    const pullOutStartsMs = 5000 + OUT_SHIFT - cfg.transitionOutMs;

    // Within one sample of the pull-out, on the near side of it.
    expect(lastSample?.tSourceMs).toBeGreaterThanOrEqual(pullOutStartsMs - FOLLOW_SAMPLE_MS);
    expect(lastSample?.tSourceMs).toBeLessThan(pullOutStartsMs);
  });

  it("never samples past the end of the take", () => {
    const atEnd = seg({
      startMs: square.durationMs - 4000,
      endMs: square.durationMs,
      position: "follow",
      waypoints: [{ id: "k0", tMs: square.durationMs - 4000, depth: 1, cx: 0.25, cy: 0.5 }],
    });
    const kfs = segmentsToKeyframes([atEnd], cfg, square, path);

    for (const k of kfs) expect(k.tSourceMs).toBeLessThanOrEqual(square.durationMs);
  });
```

- [ ] **Step 2: Run them to see the first fail**

Run: `npx vitest run src/shared/zoom/keyframes.test.ts`
Expected: `keeps following until the pull-out begins` FAILS (last sample is 3900, expected ≥ 4500). `never samples past the end of the take` passes already (it guards the change).

- [ ] **Step 3: Compute `outMs` before the tail and hand it to the sampler**

In `segmentsToKeyframes`, the block from `const tail =` (line ~149) through the `kfs.push({ id: \`${last.id}o\`` call currently computes `outMs` *after* `tail`. Reorder so it reads:

```ts
    const lastSettleMs = settles[settles.length - 1] ?? last.tMs;

    // The pull-out must not START before the activity ends.
    //
    // A segment ends at lastEvent + trailMs and the transition into this
    // keyframe starts transitionOutMs before it, so with trailMs 400 against a
    // 1000ms pull-out the camera began leaving 600ms BEFORE the last click --
    // reported as "sometimes it zooms out while I'm clicking, a little too
    // early".
    //
    // Fixed here rather than by raising trailMs, because trailMs also feeds
    // clustering: at 1200 it merged adjacent shots and took one take from 7
    // zooms to 3. Extending only the keyframe leaves the planner's spacing
    // untouched -- measured identical on all 13 takes.
    const outMs = Math.min(
      s.endMs + Math.max(0, cfg.transitionOutMs - cfg.trailMs),
      ctx.durationMs,
    );

    const tail =
      s.position === "follow" && follow !== null
        ? sampleFollow(follow, last, lastSettleMs, outMs, s, cfg, ctx, ceiling)
        : [];
    kfs.push(...tail);

    const end = tail[tail.length - 1] ?? { cx: last.cx, cy: last.cy };

    kfs.push({
      id: `${last.id}o`,
      tSourceMs: outMs,
      scale: 1,
      cx: end.cx,
      cy: end.cy,
      easing: cfg.easing,
      transitionMs: cfg.transitionOutMs,
      origin: s.origin,
      pinned: s.pinned,
    });
```

(The existing comment block about "The pull-out must not START before the activity ends" moves up with `outMs`; do not duplicate it.)

In `sampleFollow`, add the parameter and use it:

```ts
function sampleFollow(
  path: CursorPath,
  last: ZoomSegment["waypoints"][number],
  /** When the last waypoint's in-keyframe lands — not the waypoint's own tMs. */
  fromMs: number,
  /** When the out-keyframe lands; sampling stops one transition before it. */
  outMs: number,
  s: ZoomSegment,
  cfg: ZoomConfig,
  ctx: PlanContext,
  ceiling: number,
): ZoomKeyframe[] {
  const scale = depthToScale(last.depth, ceiling);
  const out: ZoomKeyframe[] = [];

  // Stop short of the pull-out: its transition starts transitionOutMs before
  // the out-keyframe, and a follow sample inside it would fight it. Measured
  // from the out-keyframe, not from the segment's end — the two differ by
  // transitionOutMs - trailMs, and measuring from the end froze the camera on
  // its last sample for those 600ms before every exit.
  const until = outMs - cfg.transitionOutMs;
```

The loop below `until` is unchanged.

- [ ] **Step 4: Run the zoom suite**

Run: `npx vitest run src/shared/zoom`
Expected: all pass, including both new tests and `never puts two keyframes on the same timestamp`.

- [ ] **Step 5: Run everything and typecheck**

Run: `npm run typecheck && npm test`
Expected: silent; `523 passed` in WSL.

- [ ] **Step 6: Commit**

```bash
git add src/shared/zoom/keyframes.ts src/shared/zoom/keyframes.test.ts
git commit -m "fix: follow camera keeps sampling until the pull-out starts instead of freezing 600ms early"
```

---

### Task 6: Export converts to BT.709 and says so

**Files:**
- Modify: `src/shared/export/ffmpegArgs.ts:128-137`
- Test: `src/shared/export/ffmpegArgs.test.ts`
- Modify: `tests/e2e/export.e2e.test.ts` (assertions at the end of the test)

**Interfaces:**
- Consumes: `buildExportArgs(o: ExportArgsOptions): string[]`; the test file's `base` and `joined`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing unit tests**

Append inside `describe("buildExportArgs", ...)` in `ffmpegArgs.test.ts`:

```ts
  /**
   * The canvas hands over sRGB RGBA. Left alone, swscale converts to YUV with
   * BT.601 coefficients and writes no colour tags; players assume BT.709 for
   * HD, so the exported chroma no longer matched the preview.
   */
  it("converts to BT.709 and tags the stream so HD players decode what the preview showed", () => {
    const s = joined(base);
    expect(s).toContain("-vf scale=out_color_matrix=bt709:out_range=tv,format=yuv420p");
    expect(s).toContain("-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv");
  });

  it("keeps the colour conversion on -vf; the video never enters the complex graph", () => {
    // -vf on a stream that -filter_complex does not produce is legal. Moving
    // the video into the complex graph would change every audio label below.
    const args = buildExportArgs(base);
    expect(args[args.indexOf("-filter_complex") + 1]).not.toContain("scale=");
    expect(args.indexOf("-vf")).toBeGreaterThan(args.indexOf("-filter_complex"));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/shared/export/ffmpegArgs.test.ts`
Expected: 2 failures (`-vf` absent).

- [ ] **Step 3: Add the conversion and tags**

The final `args.push(` in `buildExportArgs` (line ~128) becomes:

```ts
  args.push(
    // The canvas hands over sRGB RGBA. Left to itself swscale converts to YUV
    // with BT.601 coefficients and writes no colour tags, so players — which
    // assume BT.709 for HD — decoded the chroma slightly wrong and the export
    // no longer matched the preview. Convert with 709 and tag it as such.
    // A plain -vf is legal here: the video is mapped straight from input 0
    // and is not a -filter_complex output.
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    "-c:v",
    o.encoder,
    "-b:v",
    `${o.bitrateMbps}M`,
    "-pix_fmt",
    "yuv420p",
    o.outFile,
  );
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/shared/export`
Expected: all pass.

- [ ] **Step 5: Extend the e2e assertions**

In `tests/e2e/export.e2e.test.ts`, after `expect(probe(OUT, "stream=codec_name", "a:0")).toBe("aac");` add:

```ts
    // The tags are what tells a player which matrix to decode with. Probed per
    // encoder: libx264 writes VUI itself; h264_amf is the one users get.
    expect(probe(OUT, "stream=color_space", "v:0")).toBe("bt709");
    expect(probe(OUT, "stream=color_primaries", "v:0")).toBe("bt709");
    expect(probe(OUT, "stream=color_transfer", "v:0")).toBe("bt709");
```

- [ ] **Step 6: Run the e2e on Windows**

Sync the Windows clone, then with the user PATH loaded: `npx vitest run tests/e2e`
Expected: `export end to end (libx264)` and `(h264_amf)` both pass.

If `(h264_amf)` fails only on the three colour probes (`unknown` instead of `bt709`), AMF did not write VUI. Inject it with a bitstream filter: add, directly after `"tv",` (the `-color_range` value) in Step 3's `args.push`:

```ts
    // h264_amf leaves the SPS VUI empty; write the colour description into
    // the bitstream so players see it even without a container tag.
    "-bsf:v",
    "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
```

and extend the first unit test in Step 1 with `expect(s).toContain("-bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0");`. Re-run Step 4 and Step 6.

- [ ] **Step 7: Parity on Windows**

With the user PATH loaded: `npm run verify:parity`
Expected: `preview and export agree at every sampled time (30 comparisons)`, PSNR still ≥ 40 dB. (The tool extracts frames from the mp4 with ffmpeg, which honours the tags; if the tag and the conversion disagreed, PSNR would fall.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/export/ffmpegArgs.ts src/shared/export/ffmpegArgs.test.ts tests/e2e/export.e2e.test.ts
git commit -m "fix: export converts to BT.709 and tags the stream instead of untagged BT.601"
```

---

### Task 7: Preview playback keeps output and source time apart

**Files:**
- Create: `src/renderer/media/mediaClock.ts`
- Create: `src/renderer/media/mediaClock.test.ts`
- Modify: `src/renderer/ui/Editor.tsx:275-306` (replace the inline `clock`)
- Modify: `src/renderer/media/VideoElementSource.ts:45-46` (delete the dead `lastMediaTimeMs`)
- Modify: `tools/verify-parity.ts:49-54, 187-200` (a `cut` config with its own shot times)

**Interfaces:**
- Consumes: `PreviewClock` from `./PreviewPlayer` (`start(fromMs)`, `stop()`, `onFrame(cb)` — `fromMs` and `cb`'s argument are OUTPUT ms); `outputToSource`, `sourceToOutput`, `outputDurationMs` from `src/shared/project/timeline.ts`; `normalizeCuts` from `src/shared/project/cuts.ts`; `Cut` from `src/shared/project/types.ts`.
- Produces:
  ```ts
  export type ClockElement = {
    currentTime: number;                         // seconds, source time
    play(): unknown;
    pause(): void;
    requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
  };
  export type ClockTimeline = { durationMs: number; cuts: Cut[] };
  export function createMediaClock(element: () => ClockElement | null, timeline: () => ClockTimeline): PreviewClock;
  ```

- [ ] **Step 1: Write the failing tests**

`src/renderer/media/mediaClock.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { type ClockElement, createMediaClock } from "./mediaClock";

type Fake = ClockElement & { present(tSourceMs: number): void };

/** A video element reduced to what the clock touches. `present` fires rVFC. */
function fakeElement(): Fake {
  let pending: ((now: number, meta: { mediaTime: number }) => void) | null = null;
  return {
    currentTime: 0,
    play: vi.fn(),
    pause: vi.fn(),
    requestVideoFrameCallback(cb) {
      pending = cb;
      return 1;
    },
    present(tSourceMs) {
      const cb = pending;
      pending = null;
      cb?.(0, { mediaTime: tSourceMs / 1000 });
    },
  };
}

const CUT = [{ id: "c1", startMs: 1000, endMs: 2000 }];
const DURATION = 5000;

function clockOver(el: Fake, cuts = CUT) {
  return createMediaClock(
    () => el,
    () => ({ durationMs: DURATION, cuts }),
  );
}

describe("createMediaClock", () => {
  it("is the identity when there are no cuts", () => {
    const el = fakeElement();
    const clock = clockOver(el, []);
    const seen: number[] = [];

    clock.start(700);
    clock.onFrame((t) => seen.push(t));
    el.present(700);

    expect(el.currentTime).toBe(0.7);
    expect(el.play).toHaveBeenCalled();
    expect(seen).toEqual([700]);
  });

  it("starts the element at the SOURCE time behind an output time", () => {
    const el = fakeElement();
    clockOver(el).start(1500);

    // 1500 output = 1500 + the 1000ms cut before it.
    expect(el.currentTime).toBe(2.5);
  });

  /**
   * Regression. The clock used to hand the element's source time to the
   * player as output time; renderAt mapped it output→source again and sought
   * the element forward by the cut length on every frame — playback with a
   * cut ran away from the playhead.
   */
  it("reports OUTPUT time for a frame after a cut, not the element's source time", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(2500);

    expect(seen).toEqual([1500]);
  });

  it("skips the element to the cut's end when it plays into one, and reports nothing", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(1200);

    expect(seen).toEqual([]);
    expect(el.currentTime).toBe(2);
  });

  it("treats the cut's start as inside the cut", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(1000);

    expect(seen).toEqual([]);
    expect(el.currentTime).toBe(2);
  });

  it("treats the cut's end as the first frame after it", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(2000);

    expect(seen).toEqual([1000]);
  });

  /**
   * rVFC stops when the element ends, so a cut that runs to the end of the
   * take would otherwise leave the player "playing" with no frame ever
   * reaching the end.
   */
  it("reports the end of the output when the element plays into a cut that runs to the end", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el, [{ id: "tail", startMs: 4000, endMs: DURATION }]).onFrame((t) => seen.push(t));

    el.present(4100);

    expect(seen).toEqual([4000]);
    expect(el.pause).not.toHaveBeenCalled();
  });

  it("re-arms for the next frame after each one", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el, []).onFrame((t) => seen.push(t));

    el.present(100);
    el.present(200);

    expect(seen).toEqual([100, 200]);
  });

  it("does nothing before the element exists", () => {
    const clock = createMediaClock(
      () => null,
      () => ({ durationMs: DURATION, cuts: [] }),
    );

    expect(() => {
      clock.start(0);
      clock.onFrame(() => undefined);
      clock.stop();
    }).not.toThrow();
  });

  it("pauses the element on stop", () => {
    const el = fakeElement();
    clockOver(el).stop();

    expect(el.pause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/media/mediaClock.test.ts`
Expected: FAIL — cannot resolve `./mediaClock`.

- [ ] **Step 3: Create the module**

`src/renderer/media/mediaClock.ts`:

```ts
import { normalizeCuts } from "../../shared/project/cuts";
import { outputDurationMs, outputToSource, sourceToOutput } from "../../shared/project/timeline";
import type { Cut } from "../../shared/project/types";
import type { PreviewClock } from "./PreviewPlayer";

/** What the clock touches on an HTMLVideoElement. Narrow, so a test can hand in a plain object. */
export type ClockElement = {
  /** Seconds, in SOURCE time — the element knows nothing about cuts. */
  currentTime: number;
  play(): unknown;
  pause(): void;
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
};

export type ClockTimeline = { durationMs: number; cuts: Cut[] };

/**
 * A PreviewClock over a video element, in OUTPUT time.
 *
 * rVFC reports the presentation time of the frame about to be composited, so
 * the composition is aligned to the frame actually on screen rather than to a
 * time derived from the wall clock — that is what removed the old feedback
 * loop where a slow draw advanced the playhead by ~60 frames.
 *
 * The element plays SOURCE time and the player thinks in OUTPUT time. This is
 * the one place the two are converted: `start` maps output → source before
 * seeking, and every frame maps source → output before it reaches the player.
 * Doing neither handed source times to a player that mapped them again, and
 * playback across a cut ran away by the cut's length every frame.
 *
 * When the element plays into a cut, the frame is not reported and the
 * element is skipped to the cut's end. A cut that runs to the end of the take
 * is reported as the end of the output, because rVFC never fires again once
 * the element ends and the player would otherwise never stop.
 *
 * Both callbacks read through getters because the player is constructed
 * before the source is opened, and the cuts change under it.
 */
export function createMediaClock(
  element: () => ClockElement | null,
  timeline: () => ClockTimeline,
): PreviewClock {
  return {
    start(fromOutputMs) {
      const el = element();
      if (el === null) return;
      const { durationMs, cuts } = timeline();
      el.currentTime = outputToSource(fromOutputMs, durationMs, cuts) / 1000;
      void el.play();
    },

    stop() {
      element()?.pause();
    },

    onFrame(cb) {
      const tick = (_now: number, meta: { mediaTime: number }): void => {
        const el = element();
        if (el === null) return;

        const { durationMs, cuts } = timeline();
        const tSource = meta.mediaTime * 1000;
        const tOutput = sourceToOutput(tSource, durationMs, cuts);

        if (tOutput !== null) {
          cb(tOutput);
        } else {
          const cut = normalizeCuts(cuts, durationMs).find(
            (c) => tSource >= c.startMs && tSource < c.endMs,
          );
          if (cut !== undefined && cut.endMs >= durationMs) {
            cb(outputDurationMs(durationMs, cuts));
          } else if (cut !== undefined) {
            el.currentTime = cut.endMs / 1000;
          }
        }

        el.requestVideoFrameCallback(tick);
      };
      element()?.requestVideoFrameCallback(tick);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/media/mediaClock.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Wire it into the editor and delete the dead field**

In `Editor.tsx`, replace lines 275–306 — from the comment `/**\n     * The playhead during playback, taken from the video element itself.` through the closing `};` of `const clock: PreviewClock = { ... }` — with:

```ts
    const clock = createMediaClock(
      () => sourceRef.current?.el ?? null,
      () => ({ durationMs: manifest.durationMs, cuts: live.current.project.cuts }),
    );
```

Change the import at line 32 from `import { type PreviewClock } from "../media/PreviewPlayer";` to:

```ts
import { createMediaClock } from "../media/mediaClock";
```

(If `PreviewClock` is referenced anywhere else in `Editor.tsx` — `grep -n PreviewClock src/renderer/ui/Editor.tsx` — keep a `import type { PreviewClock } ...` line as well; it should not be.)

In `VideoElementSource.ts`, delete lines 45–46:

```ts
  /** Presentation time of the frame most recently reported by rVFC. */
  lastMediaTimeMs = 0;
```

(It was written by the old clock and never read: `grep -rn lastMediaTimeMs src` must now return nothing.)

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: silent; `535 passed`.

- [ ] **Step 7: Add a cut configuration to parity**

In `tools/verify-parity.ts`, the `CONFIGS` element type (line 49) gains two optional fields and one entry:

```ts
const CONFIGS: Array<{
  name: string;
  style?: Partial<Project["style"]>;
  output?: Partial<Project["output"]>;
  zoom?: Partial<Project["zoom"]>;
  cuts?: Project["cuts"];
  /** Output times to compare when the default SHOTS would overrun a cut config's shorter output. */
  shots?: number[];
}> = [
```

Append this entry after `"hidden"`:

```ts
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
```

In `prepare()`, add `cuts` to the project literal:

```ts
  const project: Project = {
    ...base,
    style: { ...base.style, ...config.style },
    output: { ...base.output, ...config.output },
    zoom: { ...base.zoom, ...config.zoom },
    cuts: config.cuts ?? base.cuts,
  };
```

In the main loop, replace the two uses of `SHOTS` inside `for (const config of CONFIGS)` with a per-config list. At the top of the loop body add:

```ts
  const shots = config.shots ?? SHOTS;
```

then use `shots.join(",")` for `ZOOMCAST_PARITY_SHOTS` and `for (const t of shots)` for the comparison loop.

- [ ] **Step 8: Run parity on Windows**

Sync the Windows clone, then with the user PATH loaded: `npm run verify:parity`
Expected: `preview and export agree at every sampled time (35 comparisons)`; the five `cut` rows say `match`.

- [ ] **Step 9: Hand-check playback across a cut**

Still on Windows: `npm run build; npx electron .`. Ask the user to open the fixture-sized take (or any recording), add a cut mid-take via the cut lane, put the playhead before the cut and press **Space**. Expected: the playhead runs at real time through the seam and the video jumps once over the cut. Before the fix it stuttered and outran the timeline.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/media/mediaClock.ts src/renderer/media/mediaClock.test.ts src/renderer/ui/Editor.tsx src/renderer/media/VideoElementSource.ts tools/verify-parity.ts
git commit -m "fix: preview media clock converts between output and source time so playback across a cut no longer runs away"
```

---

### Task 8: Biome lint gate

**Files:**
- Create: `biome.json`
- Modify: `package.json` (devDependency + `lint` script)
- Modify: the ten files Biome flags (list in Step 3)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint` (exit 0 on a clean tree), used by Task 9's CI.

- [ ] **Step 1: Install and configure**

Run: `npm install --save-dev --save-exact @biomejs/biome@2.5.14`

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["src/**", "tools/**", "tests/**", "*.config.ts"] },
  "formatter": { "enabled": false },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "overrides": [
    {
      "includes": ["src/renderer/gl/**"],
      "linter": {
        "rules": {
          "correctness": {
            "useHookAtTopLevel": "off"
          }
        }
      }
    },
    {
      "includes": ["**/*.test.ts"],
      "linter": {
        "rules": {
          "style": {
            "noNonNullAssertion": "off"
          }
        }
      }
    }
  ]
}
```

Why: the formatter stays off for now — a whole-repo reformat does not belong on a branch about to merge. `useHookAtTopLevel` is off under `gl/` because it matches WebGL's `gl.useProgram` as a React hook. Non-null assertions are fine in tests.

Add the script to `package.json` after `"typecheck"`:

```json
    "lint": "biome lint .",
```

- [ ] **Step 2: See what is left**

Run: `npm run lint`
Expected: about 10 findings remain — the two overrides removed 9 (five `useHookAtTopLevel`, four `noNonNullAssertion`); Tasks 2 and 7 may have added or removed an unused import.

- [ ] **Step 3: Apply the safe fixes, then the two by hand**

Run: `npx biome lint --write .`

Anything still listed afterwards whose fix Biome marks unsafe: run `npx biome lint --write --unsafe <that file>` and read the diff before keeping it.

That fixes: `src/shared/zoom/geometry.ts:1` and `src/shared/zoom/camera.ts:3` (unused imports), `src/renderer/ui/Editor.tsx:24,32` (`import { type X }` → `import type { X }`; line 32 may already be gone after Task 7), `src/main/index.ts:248` (string concatenation → template), `src/renderer/gl/Renderer.ts:248` (optional chain), `src/shared/cursor/path.ts:78` (`Math.pow` → `**`), `src/renderer/global.d.ts:24` (the trailing `export {}` — the file already has a top-level `import`, so it is a module without it).

By hand:

1. `src/shared/zoom/keyframes.test.ts:230` — in `"never leaves the source"`, delete the unused line `const frame = screenRect(square.source, square.output, square.paddingFactor);`. If `screenRect` is then unused in the file, remove it from the import on line 3.
2. `src/renderer/ui/Editor.tsx:580` — the whole-project effect deliberately depends on `project`. Directly above the `useEffect(() => {` add:

```ts
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect must re-run on every project change; that is the one way an edit reaches a paused preview (see the comment above)
```

- [ ] **Step 4: Verify the gate, the types and the suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: `Checked N files. No fixes applied.` with no errors or warnings; typecheck silent; `535 passed`. If typecheck fails on `global.d.ts` after the `export {}` removal, restore the line and put `// biome-ignore lint/complexity/noUselessEmptyExport: keeps this a module for the global augmentation` above it.

- [ ] **Step 5: Commit**

```bash
git add biome.json package.json package-lock.json src tools tests
git commit -m "chore: add Biome as the lint gate and clear its findings"
```

---

### Task 9: CI on windows-latest, and the docs that point at it

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docs/DEVELOPER-GUIDE.md` (§6 table)
- Modify: `README.md` (Verification table)

**Interfaces:**
- Consumes: `npm run lint` (Task 8), the skip-without-ffmpeg e2e (Task 1).
- Produces: nothing.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
  pull_request:

jobs:
  windows:
    # Windows only, by design: capture is DXGI, input is uiohook, cursor
    # shapes come from user32. The pure suite would pass on Linux, but a
    # green tick that never touched the platform the app runs on is worthless.
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - run: npm run typecheck
      - run: npm run lint

      # A static build with libx264, so the e2e export runs rather than skips.
      - uses: FedericoCarboni/setup-ffmpeg@v3

      - run: npm test

      - run: npm run build

      # The installer, unsigned. verify:* and bench:* need a GPU and Desktop
      # Duplication and stay manual.
      - run: npx electron-builder --win --publish never

      - uses: actions/upload-artifact@v4
        with:
          name: zoomcast-installer
          path: release/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: Document the gate**

In `docs/DEVELOPER-GUIDE.md` §6, add a row after `npm run typecheck`:

```markdown
| `npm run lint` | Biome. Must report no errors or warnings. |
```

and after the table add:

```markdown
Every push runs typecheck, lint, the unit suite, the e2e export (libx264) and
an installer build on `windows-latest` (`.github/workflows/ci.yml`); the
installer is attached to the run as an artifact. The GPU-bound gates
(`verify:*`, `bench:*`) stay manual.
```

In `README.md`'s Verification table, add after the `npm run typecheck` row:

```markdown
| `npm run lint` | Biome, must be clean |
```

- [ ] **Step 3: Validate the YAML locally**

Run: `npx --yes js-yaml .github/workflows/ci.yml > /dev/null`
Expected: exit 0 with no error (js-yaml parses the file and prints it as JSON; a syntax error fails the parse).

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/ci.yml docs/DEVELOPER-GUIDE.md README.md
git commit -m "ci: typecheck, lint, test and build the installer on windows-latest"
git push -u origin HEAD
```

Then ask the user to open the Actions tab on `EpicAryan/zoomcast` and report the run's result; this session has no GitHub credentials. Expected: green, with `zoomcast-installer` attached.

---

### Task 10: Whole-branch gates and the record of them

**Files:**
- Modify: `docs/superpowers/notes/2026-09-26-codebase-review.md` (a "Fixed" line per V1–V6)

- [ ] **Step 1: Run every gate that applies**

WSL: `npm run lint && npm run typecheck && npm test`
Windows (synced, user PATH loaded): `npm run verify:decode; npm run verify:parity; npm run verify:capture; npx vitest run tests/e2e`
Expected: lint clean; typecheck silent; `535 passed`; decode 6/6; parity 35/35; capture ddagrab ≥ 50 fps; e2e 2/2.

- [ ] **Step 2: Record the outcome in the review note**

Under "## Verified bugs" in the note, add a final column or a line below the table: `Fixed 2026-09-26 in <commits>: V1 (Task 7), V2 (Task 2), V3 (Task 3), V4 (Task 6), V5 (Task 5), V6 (Task 4).`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-09-26-codebase-review.md
git commit -m "docs: record the review round 1 fixes"
```
