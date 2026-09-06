# Phase C — export diagnosability and reproducibility

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an export say what it was made from and why it failed, so an
export defect can be reproduced instead of re-investigated from zero.

**Architecture:** Diagnostics stay in the main process, which already owns
`logDiag`; the renderer gains no general-purpose logging channel, only a
`reason` on the cancel it already calls. The message *formatting* moves into
`src/shared/`, where it is pure and testable in plain node. Reproducibility
comes from writing `project.json` at export time using the `saveProject` path
that already exists but is wired only to a manual button.

**Tech Stack:** TypeScript, Electron (main/preload/renderer split), vitest,
ffmpeg via `child_process`.

**Spec:** `docs/specs/2026-09-04-composition-and-camera-design.md` (§10 preview
and export, §13 phases). Evidence this plan argues from:
`docs/superpowers/notes/2026-09-05-export-truncated-bug.md`, including the
2026-09-06 update.

## Global Constraints

- `src/shared/` must not import electron, touch the DOM, or hit the filesystem.
  That purity is why the tests run in plain node.
- Everything runs **natively on Windows in PowerShell**, never under WSL:
  `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.
- Main-process stdout is invisible on Windows. Use `logDiag()` from
  `src/main/log.ts`, never bare `console.error`.
- Anyone adding a field to `Project` must add it to `normalizeProject` in
  `src/shared/project/migrate.ts`, or old projects silently lose it on load.
- `ZoomcastApi` in `src/shared/api.ts` is deliberately small. Widen it only
  where a task requires, and say why in the type's doc comment.
- Baseline before starting: 211 tests / 29 files passing, typecheck silent,
  `verify:decode` 6/6, `verify:parity` 15/15. `npm run build` before
  `verify:parity`, or it silently tests the previous code.

## Scope

**In scope:** export diagnostics, export reproducibility, an automated guard for
the encoder used in anger, and an honest encoder measurement.

**Out of scope — these belong to the phase C camera plan, which does not exist
yet.** They are recorded here because the export investigation surfaced them:

- The planner opens a take with a keyframe at `t=0`, which cannot be eased into
  (its transition would start at −600ms), so the video **opens already at max
  zoom**.
- At 1080p source into 1080p output `maxComfortableZoom` is exactly
  `1/0.85 = 1.176`, which is precisely the factor at which the screen fills the
  padded frame. **Max zoom exactly cancels the phase B composition.**

Task 5 investigates the head-of-file jump only far enough to say which of those
two — or neither — produced it. Fixing the camera is the next plan's job.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/export/diagnostics.ts` | **Create.** Pure formatting of export log lines. No electron, no fs. |
| `src/shared/export/diagnostics.test.ts` | **Create.** Node tests for the formatter. |
| `src/shared/api.ts` | **Modify.** `exportCancel` gains a `reason`. |
| `src/preload/index.mts` | **Modify.** Pass the reason through. |
| `src/main/ipc.ts` | **Modify.** Log start, finish and cancel via `logDiag`. |
| `src/main/exportRunner.ts` | **Modify.** Expose the ffmpeg stderr tail for the cancel log. |
| `src/renderer/media/exportClip.ts` | **Modify.** Pass a reason on cancel. |
| `src/renderer/ui/Editor.tsx` | **Modify.** Save `project.json` before exporting. |
| `tests/e2e/export.e2e.test.ts` | **Modify.** Run over both encoders. |
| `tools/bench-encoders.ts` | **Create.** Measure encoders on one real take. |
| `package.json` | **Modify.** Add the `bench:encoders` script. |

---

### Task 1: A pure formatter for export diagnostics

`logDiag` lives in main and imports electron, so nothing about it can be tested
in node. Formatting is the part worth testing, so it goes in `src/shared/`.

**Files:**
- Create: `src/shared/export/diagnostics.ts`
- Test: `src/shared/export/diagnostics.test.ts`

**Interfaces:**
- Consumes: `ExportArgsOptions` from `src/shared/export/ffmpegArgs.ts`.
- Produces: `formatExportStart(opts: ExportArgsOptions): string` and
  `formatExportFailure(reason: string, stderrTail: string): string`. Task 3
  calls both from `src/main/ipc.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/export/diagnostics.test.ts
import { describe, expect, it } from "vitest";
import { formatExportStart, formatExportFailure } from "./diagnostics";
import type { ExportArgsOptions } from "./ffmpegArgs";

const OPTS: ExportArgsOptions = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateMbps: 12,
  encoder: "h264_amf",
  durationMs: 26767,
  cuts: [{ startMs: 1000, endMs: 2000 }],
  audio: [
    { file: "C:/x/mic.webm", gainDb: 0, startOffsetMs: -6587 },
    { file: "C:/x/system.webm", gainDb: -6, startOffsetMs: -938 },
  ],
  syncNudgeMs: 0,
  outFile: "C:/Users/x/Downloads/take.mp4",
};

describe("formatExportStart", () => {
  it("records every setting needed to reproduce the export", () => {
    const line = formatExportStart(OPTS);

    // The encoder is the whole reason this log exists: the button and the
    // test hook use different ones, and only one of them is ever exercised.
    expect(line).toContain("encoder=h264_amf");
    expect(line).toContain("1920x1080@60");
    expect(line).toContain("bitrate=12M");
    expect(line).toContain("durationMs=26767");
    expect(line).toContain("cuts=1");
    expect(line).toContain("audio=2");
    expect(line).toContain("offsets=-6587,-938");
  });

  it("says cuts=0 rather than omitting the field", () => {
    expect(formatExportStart({ ...OPTS, cuts: [] })).toContain("cuts=0");
  });

  it("does not log the output path, which can carry a real name", () => {
    expect(formatExportStart(OPTS)).not.toContain("Users");
  });
});

describe("formatExportFailure", () => {
  it("keeps the reason and the tail of ffmpeg's stderr", () => {
    const line = formatExportFailure("frame 812: source.frameAt threw", "x264: bad\nlast line");
    expect(line).toContain("frame 812");
    expect(line).toContain("last line");
  });

  it("truncates a long stderr from the FRONT, keeping the end", () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const line = formatExportFailure("cancelled", long);

    // ffmpeg's real error is always its last output, never its first.
    expect(line).toContain("line 399");
    expect(line).not.toContain("line 0");
    expect(line.length).toBeLessThan(2500);
  });

  it("survives an empty stderr", () => {
    expect(formatExportFailure("cancelled", "")).toContain("cancelled");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/export/diagnostics.test.ts"
```

Expected: FAIL — `Cannot find module './diagnostics'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/export/diagnostics.ts
import type { ExportArgsOptions } from "./ffmpegArgs";

/** Keep the log line bounded; ffmpeg's real error is always at the end. */
const MAX_STDERR_CHARS = 2000;

/**
 * One line describing everything an export was made from.
 *
 * The output path is deliberately omitted: it is chosen by the user and can
 * carry a real name, and it tells you nothing about why an export behaved the
 * way it did.
 */
export function formatExportStart(o: ExportArgsOptions): string {
  const offsets = o.audio.map((a) => a.startOffsetMs).join(",");

  return [
    `encoder=${o.encoder}`,
    `${o.width}x${o.height}@${o.fps}`,
    `bitrate=${o.bitrateMbps}M`,
    `durationMs=${o.durationMs}`,
    `cuts=${o.cuts.length}`,
    `audio=${o.audio.length}`,
    `offsets=${offsets}`,
    `syncNudgeMs=${o.syncNudgeMs}`,
  ].join(" ");
}

export function formatExportFailure(reason: string, stderrTail: string): string {
  const tail =
    stderrTail.length > MAX_STDERR_CHARS
      ? stderrTail.slice(stderrTail.length - MAX_STDERR_CHARS)
      : stderrTail;

  return tail === "" ? reason : `${reason}\nffmpeg stderr (tail):\n${tail}`;
}
```

- [ ] **Step 4: Run the test again**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/export/diagnostics.test.ts"
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/export/diagnostics.ts src/shared/export/diagnostics.test.ts
git commit -m "feat(phase-c): a pure formatter for export diagnostics"
```

---

### Task 2: Expose ffmpeg's stderr tail from the session

`ExportSession` accumulates stderr already but keeps it private, so a cancel
throws it away. The failure reason is usually in there.

**Files:**
- Modify: `src/main/exportRunner.ts`

**Interfaces:**
- Produces: `ExportSession.stderrTail(): string`. Task 3 calls it from
  `src/main/ipc.ts`.

- [ ] **Step 1: Add the accessor**

In `src/main/exportRunner.ts`, immediately after the `cancel()` method:

```ts
  /**
   * What ffmpeg has said so far. Read on cancel: a truncating export leaves
   * its only explanation here, and until now cancel discarded it.
   */
  stderrTail(): string {
    return this.stderr;
  }
```

- [ ] **Step 2: Typecheck**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add src/main/exportRunner.ts
git commit -m "feat(phase-c): let a cancelled export surface ffmpeg's stderr"
```

---

### Task 3: Route export start, finish and failure to `logDiag`

The defect this fixes: `runExport` in `Editor.tsx` puts a failure into React
state and nowhere else, so `main-error.log` has no export entry at all.

**Files:**
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.mts`
- Modify: `src/main/ipc.ts`
- Modify: `src/renderer/media/exportClip.ts`

**Interfaces:**
- Consumes: `formatExportStart`, `formatExportFailure` (Task 1);
  `stderrTail()` (Task 2).
- Produces: `exportCancel(id: string, reason: string): Promise<void>` — a
  required second parameter, so every call site has to say why.

- [ ] **Step 1: Widen the API type**

In `src/shared/api.ts`, replace the `exportCancel` line:

```ts
  /**
   * Abandon an export. `reason` is required because a cancelled export is the
   * only path that leaves a truncated file, and it used to leave no trace.
   */
  exportCancel: (id: string, reason: string) => Promise<void>;
```

- [ ] **Step 2: Pass it through the preload**

In `src/preload/index.mts`:

```ts
  exportCancel: (id: string, reason: string) =>
    ipcRenderer.invoke("export:cancel", id, reason) as Promise<void>,
```

- [ ] **Step 3: Log in main**

In `src/main/ipc.ts`, add to the existing imports:

```ts
import { formatExportFailure, formatExportStart } from "../shared/export/diagnostics";
import { logDiag } from "./log";
```

Then replace the four export handlers:

```ts
  ipcMain.handle("export:start", (_event, opts: ExportStartOptions) => {
    const id = randomUUID();
    logDiag("export:start", `${id} ${formatExportStart(opts)}`);
    sessions.set(id, ExportSession.start(opts));
    return id;
  });

  ipcMain.handle("export:frame", async (_event, id: string, frame: Uint8Array) => {
    const session = sessions.get(id);
    if (session === undefined) throw new Error(`no export session ${id}`);
    await session.write(frame);
  });

  ipcMain.handle("export:finish", async (_event, id: string) => {
    const session = sessions.get(id);
    if (session === undefined) throw new Error(`no export session ${id}`);
    try {
      await session.finish();
      logDiag("export:finish", `${id} ok`);
    } catch (err) {
      logDiag("export:finish", `${id} ${formatExportFailure(String(err), session.stderrTail())}`);
      throw err;
    } finally {
      sessions.delete(id);
    }
  });

  ipcMain.handle("export:cancel", (_event, id: string, reason: string) => {
    const session = sessions.get(id);
    if (session !== undefined) {
      logDiag("export:cancel", `${id} ${formatExportFailure(reason, session.stderrTail())}`);
      session.cancel();
    }
    sessions.delete(id);
  });
```

- [ ] **Step 4: Give the renderer's two cancels a reason**

In `src/renderer/media/exportClip.ts`, the cancel in the cancellation check:

```ts
      if (opts.signal?.cancelled === true) {
        await window.zoomcast.exportCancel(id, `cancelled by user at frame ${frame.index}`);
        return;
      }
```

and the cancel in the catch:

```ts
  } catch (err) {
    await window.zoomcast.exportCancel(id, err instanceof Error ? (err.stack ?? err.message) : String(err));
    throw err;
  }
```

- [ ] **Step 5: Typecheck and run the suite**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test"
```

Expected: typecheck silent, 217 tests passing (211 + Task 1's 6).

- [ ] **Step 6: Commit**

```bash
git add src/shared/api.ts src/preload/index.mts src/main/ipc.ts src/renderer/media/exportClip.ts
git commit -m "fix(phase-c): export failures now reach main-error.log"
```

---

### Task 4: Persist the project at export time

The bundle for the failing take has no `project.json`, because `saveProject` is
wired only to a manual button at `Editor.tsx:387`. An export is exactly the
moment the state is worth keeping: it is the state the file was made from.

**Files:**
- Modify: `src/renderer/ui/Editor.tsx` (in `runExport`, around line 299)

**Interfaces:**
- Consumes: the existing `window.zoomcast.saveProject(dir, project)`.

- [ ] **Step 1: Save before starting the export**

In `runExport`, immediately after the target is chosen and before
`setExporting("starting…")`:

```ts
      // Persist what this export is being made from. Without this a bundle
      // cannot be re-exported identically, which is how the 2026-09-05
      // truncation investigation lost its evidence.
      await window.zoomcast.saveProject(bundle.dir, project);
```

- [ ] **Step 2: Typecheck**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
```

Expected: silent.

- [ ] **Step 3: Verify by hand — this has no automated path**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx electron ."
```

Open a take, export it, then confirm both artefacts exist:

```powershell
powershell.exe -NoProfile -Command "Get-Content \"$env:LOCALAPPDATA\zoomcast\recordings\<id>\project.json\" -Raw"
powershell.exe -NoProfile -Command "Get-Content \"$env:APPDATA\zoomcast\main-error.log\" -Tail 5"
```

Expected: `project.json` present, and `main-error.log` carrying an
`export:start` line naming `encoder=h264_amf` and the output size.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui/Editor.tsx
git commit -m "fix(phase-c): save project.json when exporting, so an export can be reproduced"
```

---

### Task 5: Guard the encoder that is actually used

`Editor.tsx` hardcodes `libx264` in the test hook and `h264_amf` in the button.
Every automated check runs the first; the second is the one users get. This is
the same shape as phase A shipping five broken cursor shapes because the
fixture emitted no cursor events.

**Files:**
- Modify: `tests/e2e/export.e2e.test.ts`

- [ ] **Step 1: Make the existing test take an encoder**

Replace the `describe` block's opening so the body becomes a loop. Change:

```ts
describe("export end to end", () => {
  it("produces a playable mp4 with video and mixed, cut-aware audio", async () => {
```

to:

```ts
/** Encoders ffmpeg on this machine can actually use. */
function availableEncoders(): string[] {
  const listed = execFileSync("ffmpeg", ["-v", "error", "-encoders"], {
    encoding: "utf8",
  });
  return ["libx264", "h264_amf"].filter((e) => listed.includes(e));
}

describe.each(availableEncoders())("export end to end (%s)", (encoder) => {
  it("produces a playable mp4 with video and mixed, cut-aware audio", async () => {
```

- [ ] **Step 2: Use the parameter, and give each encoder its own file**

Inside the test, change the output path and the encoder field:

```ts
    const OUT_FOR = join(TMP, `e2e-export-${encoder}.mp4`);
```

Replace every later use of `OUT` in this test with `OUT_FOR`, and set:

```ts
      encoder,
```

in place of `encoder: "libx264",`.

Two encoders writing one path would race and the second would silently assert
against the first's file.

- [ ] **Step 3: Run it**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run tests/e2e/export.e2e.test.ts"
```

Expected: two passing cases if `h264_amf` is present, one if not. If the
`h264_amf` case fails, **that is the bug this whole plan exists for — stop and
record what it says** rather than making the test tolerant.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/export.e2e.test.ts
git commit -m "test(phase-c): run the export e2e over every available encoder"
```

---

### Task 6: Measure both encoders honestly

`docs/superpowers/notes/2026-09-05-export-truncated-bug.md` claimed `h264_amf`
runs at ~8fps / 0.13x realtime. A real export on 2026-09-06 did 1606 frames in
~50s — about 32fps. One of those is wrong, and the choice of default encoder
currently rests on the wrong one.

**Files:**
- Create: `tools/bench-encoders.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the benchmark**

```ts
// tools/bench-encoders.ts
/**
 * Encode the same synthetic frames through each encoder and report fps.
 *
 * Not a test: it measures the machine, so it has no assertion to make. It
 * exists because the encoder default was chosen from a figure nobody could
 * reproduce.
 *
 * Run: npm run bench:encoders
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { planExportFrames } from "../src/shared/export/exportPlan";
import type { ExportArgsOptions } from "../src/shared/export/ffmpegArgs";
import { runExport } from "../src/main/exportRunner";

const TMP = join(process.cwd(), "tmp", "bench");
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const DURATION_MS = 10_000;

async function bench(encoder: string): Promise<void> {
  const frames = planExportFrames(DURATION_MS, [], FPS);
  const opts: ExportArgsOptions = {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    bitrateMbps: 12,
    encoder,
    durationMs: DURATION_MS,
    cuts: [],
    audio: [],
    syncNudgeMs: 0,
    outFile: join(TMP, `${encoder}.mp4`),
  };

  // One buffer, refilled per frame: allocating 8MB 600 times would measure the
  // allocator as much as the encoder.
  const buf = new Uint8Array(WIDTH * HEIGHT * 4);
  const started = Date.now();

  await runExport(opts, frames, (frame) => {
    buf.fill(frame.index % 255);
    return Promise.resolve(buf);
  });

  const seconds = (Date.now() - started) / 1000;
  const fps = frames.length / seconds;
  console.log(
    `${encoder.padEnd(10)} ${frames.length} frames in ${seconds.toFixed(1)}s ` +
      `= ${fps.toFixed(1)}fps, ${(fps / FPS).toFixed(2)}x realtime`,
  );
}

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  for (const encoder of ["libx264", "h264_amf"]) {
    try {
      await bench(encoder);
    } catch (err) {
      console.log(`${encoder.padEnd(10)} FAILED: ${String(err)}`);
    }
  }
}

void main();
```

- [ ] **Step 2: Add the script**

In `package.json`, alongside the other `tools/` scripts:

```json
    "bench:encoders": "tsx tools/bench-encoders.ts",
```

- [ ] **Step 3: Run it**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run bench:encoders"
```

Expected: two lines with real numbers. This measures encoding only — no GL
render, no IPC — so it is a ceiling, not the export rate.

- [ ] **Step 4: Record the result and correct the note**

Replace the ~8fps / 0.13x claim in
`docs/superpowers/notes/2026-09-05-export-truncated-bug.md` with the measured
numbers, and state whether `h264_amf` is in fact the faster path here. If it is
not, say so plainly — the button picked it on the assumption that hardware wins.

- [ ] **Step 5: Commit**

```bash
git add tools/bench-encoders.ts package.json docs/superpowers/notes/2026-09-05-export-truncated-bug.md
git commit -m "test(phase-c): measure both encoders instead of assuming"
```

---

### Task 7: Reproduce the head-of-file jump against a saved project

Only now is this worth attempting: Tasks 3 and 4 mean an export records what it
was made from, so a repro can be exact.

**Files:** none changed by default. This task's deliverable is a finding.

**Evidence already gathered — do not re-derive it.** See the 2026-09-06 update
in `docs/superpowers/notes/2026-09-05-export-truncated-bug.md`. Ruled out:
VFR-vs-CFR content warping, output→source mapping drift, wrong duration, the
easing's first step, and `zoomAt` under `DEFAULT_ZOOM_CONFIG`.

- [ ] **Step 1: Re-export the take that showed it**

Take `2026-09-05T13-13-31`. Export it, then read back both the saved
`project.json` and the `export:start` line from `main-error.log`.

- [ ] **Step 2: Measure the head of the new file**

```powershell
powershell.exe -NoProfile -Command "ffmpeg -v error -i <out.mp4> -vf \"select=lt(n\,90),tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-\" -f null -"
```

Expected if the defect reproduces: near-zero deltas to ~1.03s, then a single
step an order of magnitude larger than the eased motion that follows.

- [ ] **Step 3: Decide which explanation survives**

Compare the saved `project.json`'s `paddingFactor` and frame settings against
the defaults. The measured jump implies a padding factor of **0.75**, not the
0.85 default; if the saved project confirms a non-default padding, the jump is
a settings-dependent geometry bug and the next step is a parity configuration
at that padding. If the saved project is all defaults, the jump is in the
export loop rather than the plan, and `verify:parity` needs a shot at
`t ≈ 1040ms` — the head of the timeline is currently unsampled.

- [ ] **Step 4: Write the finding into the note, and stop**

Fixing the camera — the `t=0` keyframe that cannot ease in, and max zoom
exactly cancelling the composition — belongs to the phase C camera plan, which
this task's finding should inform rather than pre-empt.

---

## Self-Review

**Spec coverage.** This plan covers the export half of spec §10; the preview
loop rewrite and the camera work in §10 and §9 are explicitly out of scope
above and need their own plan.

**Placeholders.** None: every code step carries the actual code, and Task 7's
deliverable is a finding with stated decision criteria rather than a "TBD".

**Type consistency.** `formatExportStart` / `formatExportFailure` (Task 1) are
consumed with those exact names in Task 3. `stderrTail()` (Task 2) is called in
Task 3. `exportCancel(id, reason)` is widened in `src/shared/api.ts`, threaded
through the preload, and both renderer call sites are updated in the same task,
so no intermediate state fails typecheck.

**Ordering.** Tasks 1–3 are the instrumentation, 4 is reproducibility, 5–6 close
the guard and measurement gaps, and 7 spends the capability the earlier tasks
buy. Task 7 depends on 3 and 4; nothing else has a cross-task dependency.
