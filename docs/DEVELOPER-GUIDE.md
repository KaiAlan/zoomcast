# zoomcast — developer guide

Written 2026-09-18 as the handoff to a new developer. It is the single entry
point: what the product does, how it is built, where every piece lives, what is
done, what is open, and what to do next. Where a topic already has a detailed
document, this guide summarises it and links to it rather than repeating it.

If you read only one other file, read `HANDOVER.md` — specifically its
"Things that will bite you" section. Every entry there cost real time.

> You are reading this on `main`. Phase E (timeline editing) and the latest
> `HANDOVER.md` live on the branch `phase-e-timeline-editing` — check it out to
> continue the work: `git checkout phase-e-timeline-editing`. Test counts and
> phase E file references below describe that branch; `main` has 418 tests in
> 46 files.

---

## 1. What zoomcast is

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio / Recordly equivalent, built for personal use.

Press a hotkey, record, and the editor opens with zooms already planned from
what you actually did: where you clicked, typed, scrolled and paused. Style the
frame, cut it, adjust the camera, and export an MP4.

The flow:

```
Ctrl+Alt+Z ─► 3-2-1 countdown ─► red border while recording ─► Ctrl+Alt+Z again
     │
     ▼
recording bundle on disk  (screen.mp4 + mic.webm + system.webm + input.jsonl + manifest.json)
     │
     ▼
editor opens ─► planner turns telemetry into zoom segments ─► preview ─► edit ─► export MP4
```

## 2. Status at a glance

| Area | State |
| --- | --- |
| Recording (screen, mic, system audio, telemetry) | Done, on `main` |
| Automatic zoom planning | Done, on `main`, tuned against real takes |
| Camera (fixed / follow per shot, depth grading) | Done, on `main` |
| Synthetic cursor + click ripples | Done, on `main` |
| Compositor (backgrounds, frame, aspect, resolution) | Done, on `main` |
| Directional motion blur (phase D) | Done, on `main`, off by default |
| Export (MP4, mixed audio, hardware encoder) | Done, on `main` |
| Timeline editing, undo/redo, shortcuts (phase E) | Code complete on branch `phase-e-timeline-editing`; 2 important + 5 minor review fixes open; UI never driven by a human |
| Clip speed (phase F) | Not started, spec only, may be abandoned |
| UI revamp (phase G) | Not started, needs its own design pass |
| Webcam picture-in-picture | Not started, data model stub exists |

### Branches

| Branch | What is on it |
| --- | --- |
| `main` | Phases 0–7 and A–D. Stable, everything verified. |
| `phase-e-timeline-editing` | `main` + 17 phase E commits + this guide. **Work from here.** Not merged — see §9. |

### Gate status on `phase-e-timeline-editing` (2026-09-18)

- `npm test` — 521 passing, 51 files
- `npm run typecheck` — silent
- Last full gate run (2026-09-09, commit `5b73e0a`): decode 6/6, parity 30/30,
  capture ddagrab 57.7fps, `tune -- all` byte-identical to baseline
  (md5 `0b48e73fd9719c2dce45316c6fd23348`)

## 3. Features in detail

### Recording

- Screen via ffmpeg `ddagrab` (DXGI Desktop Duplication), ~55–58fps at 1080p.
  Falls back to `gdigrab` (~28fps) when Desktop Duplication is unavailable.
- Microphone and system audio as two separate Opus tracks, recorded by a
  hidden renderer via `MediaRecorder`.
- A telemetry stream of every mouse move, click, wheel and key event
  (`uiohook-napi`), plus cursor-shape changes polled from `user32!GetCursorInfo`
  at 30Hz (`koffi`).
- The real cursor is **not** captured into the pixels (`drawMouse: false`); it
  is redrawn later so it stays sharp at any zoom.
- Capture rate choice: 30 or 60fps (settings window, from the tray).
- On hybrid-GPU laptops the app pins ffmpeg to the integrated GPU via
  `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` — only if the capture
  probe has already failed. See `src/main/capture/gpuPreference.ts`.
- Every take logs requested vs achieved frame rate (`capture:rate`).

### Automatic zoom

1. Telemetry → impulses (click, type, scroll, each weighted).
2. Impulses → clusters (by time window and screen radius).
3. Guards: minimum weight, rate cap, dwell, recovery, flinch prevention.
4. Clusters → **zoom segments**, the persisted, editable unit. A segment can
   hold several waypoints: two zooms closer than 1.5s stay zoomed in and pan
   between focus points instead of pulling out and back.
5. Segments → keyframes → the camera at any time `t`.

Depth is graded by intent (click deepest, then typing, then scroll), as a
fraction of a configurable ceiling (`maxZoom`, default 2.0). The transition
curve is `cameraZoom`, derived from Screen Studio's `cubic-bezier(0.16, 1, 0.3, 1)`
and measured against a Recordly export. Pans use their own gentler curve.

Every dial is in `src/shared/zoom/config.ts` and editable live in the inspector.

### Camera

- Zoom grows the whole composited window about the focus point and slides it
  toward the output centre. Above `1 / paddingFactor` the window bleeds off
  every edge and the background disappears. That is intentional.
- Per shot: `fixed` (arrive and hold, the default and what the reference does)
  or `follow` (tracks the cursor via a precomputed damped path).
- Every take opens at rest (no zoom on frame 1).

### Cursor

Eight vector shapes (arrow, ibeam, wait, hand, four resize), re-rasterised per
size, smoothed position path, drop shadow, click ripples. Size is constant on
screen regardless of zoom. Controls: visible, size, smoothing, shadow, ripples.

### Composition

- Background: six procedural mesh gradients, solid colour, your own image
  (copied into the project), or hidden. Blur for images (mipmap LOD).
- Frame presets: default / minimal / hidden; corner radius, shadow, border.
- Padding factor.
- Output aspect: native, 16:9, 4:3, 1:1, 9:16; resolution; fps; bitrate.
- Directional motion blur driven by camera velocity (`style.motionBlurAmount`).

### Editing (on `main`)

- Play/pause, scrub, a recordings list, re-plan live as dials change.
- Click a shot in the timeline to switch its camera between fixed and follow.

### Editing (phase E, on the branch)

- Timeline split into three lanes: ruler, zoom, cut.
- Drag and resize zoom segments, including across cuts. A dragged segment is
  pinned: re-planning no longer moves it until "reset to auto".
- Drag on empty cut-lane space to create a cut; move, resize, merge cuts.
- Per-shot popover: depth presets and camera mode.
- Undo/redo with drag coalescing (a whole drag is one step), 100-entry cap.
- Shortcuts: Ctrl+Z, Ctrl+Shift+Z, Delete/Backspace, Escape. All but Escape
  are ignored while typing in an input.

### Export

WebGL2 render of every frame through the same `Renderer` the preview uses,
piped to ffmpeg. Hardware encoder (`h264_amf`, ~1.5x realtime at 1080p60) with
`libx264` fallback. Audio mixed with per-track gain and a sync nudge. Export
writes `project.json` beside the output so it can be re-exported identically.

### App shell

- Tray app. Closing the editor does not quit; quit from the tray.
- "Start with Windows" (off by default) launches hidden at login.
- Installer: per-user NSIS, no admin (`npm run dist`).
- Recordings: `%LOCALAPPDATA%\zoomcast\recordings\<id>\`
- Settings: `%APPDATA%\zoomcast\settings.json`
- Diagnostics log: `%APPDATA%\zoomcast\main-error.log`

### Keyboard reference

| Key | Where | Action |
| --- | --- | --- |
| Ctrl+Alt+Z | anywhere | Start / stop recording (chosen at runtime from a candidate list — never hardcode it) |
| Space | editor | Play / pause |
| ← | editor | Back to recordings list |
| Ctrl+Z / Ctrl+Shift+Z | editor (branch) | Undo / redo |
| Delete / Backspace | editor (branch) | Delete selected shot or cut |
| Escape | editor (branch) | Clear selection, close popover |

## 4. Getting set up

Windows only. Capture uses DXGI, input uses `uiohook-napi`, cursor shapes call
`user32.dll`. It will not run on macOS, Linux or inside WSL.

Requirements:

- Windows 10/11 with a GPU that supports Desktop Duplication
- Node.js 20.19+ (developed on v24)
- ffmpeg 6.0+ on PATH, a full build (gyan.dev "full" or BtbN). It needs the
  `ddagrab`, `hwdownload` and `format` filters; the app checks at startup and
  logs what is missing. Override with `ZOOMCAST_FFMPEG=<path>`.

```powershell
git clone https://github.com/KaiAlan/zoomcast.git
cd zoomcast
git checkout phase-e-timeline-editing
npm install          # no native build step — prebuilt N-API binaries
npm run build
npx electron .       # or: npm run dev  (hot reload for the renderer)
```

Electron's stdout does not reach the terminal on Windows. Read
`%APPDATA%\zoomcast\main-error.log` instead, and log through `logDiag()` from
`src/main/log.ts`, never `console.error`.

Working from WSL: reading, editing and git are fine on `/mnt/c/...`; run
anything through `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.

## 5. Architecture

```
src/
  main/        Electron main process: tray, hotkey, windows, IPC, capture, ffmpeg, export
    capture/   ScreenSource (ffmpeg ddagrab/gdigrab), AudioRecorder, TelemetryRecorder,
               CursorShapeReader (koffi), SessionController, gpuPreference, duplicationSweep
  preload/     The context bridge (window.zoomcast)
  renderer/    React editor, WebGL2 compositor, export driver
    gl/        Renderer, shaders, layout, cursor and background textures
    media/     FrameSource: <video> for preview, WebCodecs VideoDecoder for export
    ui/        Editor, Timeline (+ timeline/ lanes), Inspector, StylePanel,
               SegmentPopover, Welcome, SettingsWindow, useProjectHistory
  shared/      Pure logic — no electron, no DOM, no fs. Everything unit-tested here.
    bundle/    manifest, telemetry parsing, stream time
    cursor/    shapes, smoothed path, ripples, shape tracker
    zoom/      planner, cluster, guards, segments, keyframes, camera, depth,
               viewport, easing, interpolate, replan, derive, config
    project/   Project types, defaults, migrate (normalise on load), cuts,
               timeline mapping, edits (phase E), history (phase E)
    style/     backgrounds, frame presets, aspect, colour, motion blur
    export/    export plan, ffmpeg args, diagnostics
    settings/  app-level settings
tools/         verification harnesses and benchmarks (run with tsx)
tests/         e2e export test, checked-in fixture bundle
docs/          specs (design + decisions), plans (task records), notes (bug investigations)
```

### The three rules that shape the code

1. **Preview and export call the same `Renderer`.** What you see is what you
   export, by construction. A visual feature wired into only one of them is
   this project's most repeated bug. `verify:parity` guards it. (There is a
   third `drawFrame` call site, `src/renderer/shoot.ts`, used by test harnesses;
   it draws no cursor.)
2. **`src/shared/` is pure.** No electron, DOM or filesystem. That is why the
   suite runs in plain node in ~6s.
3. **Everything is precomputed, nothing is integrated per frame.** Cursor path,
   follow path, keyframes — so a 60fps preview and a 30fps export agree.

### Data model

A recording bundle holds the raw media, `input.jsonl` (telemetry) and
`manifest.json`. The editable state is `Project` (`src/shared/project/types.ts`),
saved as `project.json` in the bundle:

- `cuts: Cut[]` — removed source ranges, each with an id
- `zoom.config` — every planner dial
- `zoom.segments` — the editable unit (start/end, waypoints, depth, position
  `fixed`/`follow`, pinned)
- `zoom.keyframes` — derived from segments, never edited directly
- `style` — padding, motion blur, frame, background, cursor
- `webcam` — stub for the unbuilt webcam feature
- `audio` — mic/system gain, sync nudge
- `output` — width, height, aspect, fps, bitrate

**`project.json` is normalised on load, never cast.** Add a field to `Project`
and you must add it to `normalizeProject` in `migrate.ts`, or old projects
silently lose it. Same rule for `Settings` and `normalizeSettings`.

### How an edit flows (phase E)

UI gesture → `edit.apply(fn)` / `edit.applyTransient(fn)` in
`useProjectHistory` → pure function from `edits.ts` → `replanFrom` /
`deriveKeyframes` (`src/shared/zoom/derive.ts`) → history entry → one
`useEffect` on the whole `project` in `Editor.tsx` re-seeks the player.
Do not add a second redraw path.

## 6. Verification toolkit

Everything runs natively on Windows. Run the full set before merging anything
that touches rendering, planning or capture.

| Command | What it proves |
| --- | --- |
| `npm test` | Unit + property tests (vitest, fast-check). 521 tests. |
| `npm run typecheck` | Must be silent. |
| `npm run build` | Three bundles (main, preload, renderer). |
| `npm run verify:decode` | A frame drawn at time t really is the frame at t. |
| `npm run verify:parity` | Preview and export composite identically — 6 configs × 5 times, 43–47dB PSNR. Builds first. |
| `npm run verify:capture` | Real capture runs on ddagrab at ~55fps; fails on gdigrab fallback. |
| `npm run tune -- all` | Replays every take on disk through the planner. Run before and after touching any zoom dial; diff the output. |
| `npm run bench:preview -- <take> [ms] [runs]` | Preview frame rate while playing. Compare batch against batch. |
| `npm run bench:encoders` | Encoder throughput. |
| `npm run camera:travel -- <take>` | Camera movement during holds, fixed vs follow. |
| `npm run render:camera -- <take>` | Renders a take twice (all fixed / all follow) to compare. |
| `npm run fixture [-- spread]` | Regenerates test fixtures (spread = 30s, six clicks, for pacing). |

Headless modes (environment variables on `npx electron .`):

| Variable | Does |
| --- | --- |
| `ZOOMCAST_SHOOT` + `ZOOMCAST_SHOOT_DIR` | Render frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` (+ `_SEEK`, `_OUT`, `_DELAY`, `_JS`) | Open a bundle in the real editor and screenshot it; `_JS` runs script first to reach a clicked state |
| `ZOOMCAST_RECORD_TEST=<s>` (+ `_RUNS=<n>`) | Full record→stop cycle, result in `%APPDATA%\zoomcast\record-test.json`. Use RUNS=2+ for anything touching process-global state |
| `ZOOMCAST_PARITY*`, `ZOOMCAST_PREVIEW_BENCH*` | Used by the verify/bench tools |

The React UI has **no test harness**. No `.tsx` file is reached by any test.

## 7. Working method

This project was built on one rule: **measure, don't guess.** Several first
fixes were wrong and caught only because a number disagreed. The pattern that
keeps recurring: a symptom blamed on a model turned out to be a cap or clamp
somewhere else ("look for the second cap").

Practical habits:

- Before changing a zoom dial, save `npm run tune -- all` output; diff after.
- Never read achieved frame rate from `avg_frame_rate`; count frames with
  `ffprobe -count_frames`.
- Compare media times in integer ticks, never float ms.
- Never hold more than one `VideoFrame`.
- Any change to rendering: rebuild, then `verify:parity`.
- Design decisions are recorded in the spec's decision log with their reason.
  Add to it rather than silently reversing one.

## 8. Documentation map

| Document | Read it for |
| --- | --- |
| `HANDOVER.md` | Full current state, every gotcha, all measurements. Long; the "Things that will bite you" section is mandatory. |
| `README.md` | User-facing overview and setup. |
| `docs/specs/2026-09-03-screen-recorder-design.md` | Original design and decisions #1–10. |
| `docs/specs/2026-09-04-composition-and-camera-design.md` | Composition, camera, the phase roadmap (§13), decisions #11–17. |
| `docs/specs/2026-09-07-camera-geometry-and-depth-design.md` | Camera geometry and depth grading. |
| `docs/specs/2026-09-08-preview-frame-source-split-design.md` | Why preview uses `<video>` and export uses WebCodecs. |
| `docs/specs/2026-09-09-phase-e-timeline-editing-design.md` | Phase E spec — binding where plan and code disagree. |
| `docs/superpowers/plans/2026-09-09-phase-e-timeline-editing.md` | Phase E's 12-task plan. |
| `docs/superpowers/plans/2026-09-09-phase-e-ledger.md` | Every ruling made during phase E and why. |
| `docs/superpowers/plans/2026-09-09-phase-e-final-review.md` | Phase E's final review findings (status in §9 below). |
| `docs/superpowers/plans/2026-09-09-phase-e-handoff.md` | **Historical.** Written mid-phase; its recovery steps (`git checkout -- Editor.tsx`, `rm useProjectHistory.ts`) would now destroy tasks 7–12. Do not follow them. |
| `docs/superpowers/notes/2026-09-05-export-truncated-bug.md` | An unreproduced export truncation. Read before touching export. |
| `docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md` | Measured evidence behind the zoom tuning. |
| Other files in `docs/superpowers/plans/` | Completed phase records; history. |

## 9. What to do next, in order

### Step 1 — finish phase E's review fixes

The final whole-branch review (`2026-09-09-phase-e-final-review.md`) said
"merge after fixes": 0 critical, 5 important, plus 5 minors marked fix-before-merge.

| Item | Status |
| --- | --- |
| I1 — a drag whose first step is a no-op loses the pre-drag state in history | Fixed, commit `0558005` |
| I2 — moving a segment across a cut keeps its *source* length; spec §7 requires *output* length (the segment visibly shrinks under the cursor). Fix `segmentDragToSource`/`moveSegment` in `edits.ts` to map the end edge too, and rewrite the test at `edits.test.ts` "preserving its output duration" around a segment that actually straddles a cut | **Open** |
| I3 — `phase-e-handoff.md` has stale destructive instructions | Fixed: superseded banner added |
| I4 — phase E ledger was in a gitignored folder | Fixed: archived to `docs/superpowers/plans/2026-09-09-phase-e-ledger.md`, `HANDOVER.md` repointed |
| I5 — the cut lane's layout formula exists three times (`CutLane.tsx`, `edits.ts` `cutLaneGeometry`, a hand copy in `edits.test.ts`). Extract one `cutLaneSpan(cuts, id, durationMs)` used by both lane and test; also extract a `useTrackWidth()` hook from the duplicated ResizeObserver block in `ZoomLane`/`CutLane` | **Open** |
| M1 — `derive.test.ts` "does not consult telemetry" is vacuous | **Open** |
| M2 — `migrate.ts` admits duplicate explicit cut ids | **Open** |
| M3 — `dragKindAt` boundary cases untested (`timeline/geometry.ts`) | **Open** |
| M4 — false comment in `CutLane.tsx` about the no-op guard | **Open** |
| M5 — lanes react to right/middle-button drags; add `e.button !== 0` guards | **Open** |

After fixing: run every gate in §6 and check `tune -- all` still hashes to
`0b48e73fd9719c2dce45316c6fd23348`.

### Step 2 — drive phase E by hand

No agent could launch the GUI, so the whole pointer/UI layer has never run.
Checklist:

- Cut lane: drag empty space to create a cut (output duration shortens); move
  a cut; drag one into another (they merge and keep following the pointer);
  drag a cut's end edge far — it cannot grow past half the remaining lane.
  Decide if that limit is acceptable (see `cutResizeToSource` in `edits.ts`).
- Zoom lane: drag and resize a segment, including across a cut.
- Popover: select a shot, press a depth preset (preview changes immediately,
  badge tracks it); "reset to auto" returns a dragged shot to planner control.
- Shortcuts: one Ctrl+Z undoes a whole drag; Ctrl+Shift+Z redoes; Delete
  removes the selection and undo restores it *selected*; Escape clears
  selection and closes the popover; Backspace inside an inspector number field
  edits the text and does not delete the shot.
- Clicking a keyframe marker in the zoom lane neither selects nor deselects —
  confirm that is acceptable.

### Step 3 — merge phase E to `main`

Fast-forward or merge once steps 1–2 are green. Update `HANDOVER.md` and the
spec §13 table.

### Step 4 — pick the next phase

| Option | Notes |
| --- | --- |
| Phase G — UI revamp | Requested by the owner; placed after E on purpose so it redesigns a finished feature set. Needs a design/brainstorm first, not a task list. The inspector is long (13 zoom fields + curve picker + cursor + style) — collapsible sections are the obvious first win. |
| Webcam PiP | Independent of everything. A third `MediaRecorder` (same hidden-renderer pattern as `AudioRecorder`), a second video source in the editor, a webcam pass in `Renderer` (`FrameState.webcam` exists), placement UI. Needs `registerDisplayMediaHandler()` treatment for `getUserMedia`. |
| Phase F — clip speed | Highest risk: makes the timeline mapping variable-slope and reverses decision #9. Abandoning it is an accepted outcome. |

**Recommendation:** Webcam PiP or small quality-of-life items first (below),
then Phase G. Leave Phase F until someone actually needs it.

### Smaller backlog

- Show the `unclean` flag (recording ended abnormally) in the Welcome list.
- Delete recordings from the UI.
- Popover clips at the lane edge for a segment near either end; flip it inward.
- Cursor glyphs: `wait` reads as two crescents, `hand` is blobby at small sizes
  (`src/shared/cursor/shapes.ts`).
- Cursor and ripples are not clipped to the rounded frame corners.
- `ripplesAt` is O(clicks before t); binary-search if it ever shows in a profile.
- A React test harness (`@testing-library/react`) — first thing to pin is that
  selecting a shot does not push an undo entry.
- ffmpeg is not bundled; an installed build on a machine without ffmpeg installs
  fine and then cannot record. Bundling a full build (not the `ffmpeg-static`
  essentials build, which broke capture once) would fix it.
- Unreproduced: one export produced a truncated MP4. See the note in §8.

## 10. Known limitations

- Windows only, by design.
- Capture on hybrid-GPU laptops depends on the GPU preference pin (automatic).
- `gdigrab` fallback tops out around 28fps.
- A keyframe at t=0 cannot be eased into, so takes open at rest.
- `maxZoom` above pixel parity upscales the source; the timeline shows
  "sharp to" for where that begins.
- No cap on how long a zoom holds — deliberate. A cap was tried and removed
  (it pulled the camera out as a 26s typing run began).

## 11. Packaging and release

```powershell
npm run dist    # -> release\zoomcast Setup <version>.exe
```

- `npmRebuild: false` is deliberate — the native addons are prebuilt N-API
  binaries; rebuilding demands Visual Studio.
- `asarUnpack: "**/*.node"` is required for both `uiohook-napi` and koffi's
  `@koromix/koffi-win32-x64`. A resolution failure is a startup crash.
- Best check on a packaged build:

  ```powershell
  $env:ZOOMCAST_RECORD_TEST = '5'
  .\release\win-unpacked\zoomcast.exe | Out-Null
  cat "$env:APPDATA\zoomcast\record-test.json"
  ```

- The icon is generated by `tools/make-icon.ts` (`npm run icon`); edit the
  drawing there, not the `.ico`.

## 12. Tech stack

Electron 44, React 19, TypeScript 7, electron-vite 5 / Vite 7 (pinned — plugin-react 6
needs Vite 8), WebGL2, WebCodecs, mp4box, ffmpeg (external), uiohook-napi, koffi,
zod, vitest 5, fast-check.
