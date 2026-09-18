# zoomcast — handover

> New to the project? Start with `docs/DEVELOPER-GUIDE.md` (2026-09-18): the
> overview, feature list, open work and next steps. This file is the deep
> reference behind it.

Updated 2026-09-08. **Phases 0–7, A, B, C and D complete, plus the camera
geometry and depth rework, the per-segment camera switch, the preview
frame-source split, and a day of camera-feel work driven entirely by
measurement — all on `main`.** The tool records
your screen, mic and system audio, plans zooms from real input telemetry,
drives a camera that opens at rest and can follow the cursor, draws a synthetic cursor with real shapes and
click ripples, composes the frame over a procedural or custom background, lets
you cut and scrub, and exports a finished MP4 at a chosen aspect and
resolution.

**Zoom grows the whole window and travels it. It does NOT crop.** The
composited window scales about the focus point and slides so the focus
approaches the output centre; above `1 / paddingFactor` it is larger than the
output and bleeds off every edge, so the background disappears while zoomed.
That is correct and deliberate — it is what the reference footage does.

This **reverses** the 2026-09-07 rework, which made the frame constant and
shrank the sampled region instead. That rework's premise was that a growing
window "capped the whole zoom range at 1/paddingFactor and left the camera with
zero freedom at the top of it" — but that was the CAP, not the model:
`maxZoom` was derived from the padding. `maxZoom` is an independent dial now,
so the growing window has all the room it needs. **Third time this codebase
blamed a model for what a cap was doing.** The user's complaint, three times
over, was "the section is zooming and getting cropped, I want the camera to
zoom and travel" — the cropping was literal.

**The per-segment follow camera landed 2026-09-07.** Click a shot in the
timeline and the inspector's "selected shot" section switches its camera
between `fixed` and `follow`. On a real 60s take that is 0px/s of motion during
a hold against **128px/s** — the camera keeps tracking the cursor instead of
arriving and freezing.

**Phase E is complete — all 12 tasks — on the branch
`phase-e-timeline-editing`, not on `main`.** See "What landed — phase E"
below for what shipped and, just as important, what has never been run. The
design is `docs/specs/2026-09-09-phase-e-timeline-editing-design.md` and the
task record is `docs/superpowers/plans/2026-09-09-phase-e-ledger.md`,
which carries every ruling made without the user in the room.

**Capture runs on ddagrab at last. 32.59fps -> 55.42fps.** The 2026-09-08
handoff's leading hypothesis was right — ffmpeg was running on the wrong GPU —
but its adapter table had the two GPUs **swapped**, and that is what made the
evidence read as "there is one output and DDA refuses it". `dx:0` was never the
AMD. With no GPU preference set, Windows hands ffmpeg the discrete NVIDIA, and
the Optimus driver rewrites DXGI enumeration for that process: the panel's
output moves onto the dGPU, the AMD reports no outputs at all, and Desktop
Duplication refuses the dGPU's copy because the desktop is composited on the
AMD. `GpuPreference=1` on ffmpeg.exe stops the rewrite. `GpuPreference=2`
measured identical to no pin. See
`docs/superpowers/plans/2026-09-08-capture-backend-handoff.md`, which now
carries the resolution.

**Two more bugs were behind that one**, both unreachable while the probe
returned gdigrab, and neither guessable from the code:

  - `-pix_fmt yuv420p` sat in the shared encode args, so it applied to the
    ddagrab path too and inserted an `auto_scale` that D3D11 frames cannot pass.
  - **`scale_d3d11` does not work on this AMD iGPU at all** — E_INVALIDARG
    allocating its NV12 texture. Feeding BGRA D3D11 frames straight to
    `h264_amf` fails too. The chain is now
    `ddagrab,hwdownload,format=bgra,format=nv12`, which costs nothing measurable
    because the capturing GPU is the integrated one and its memory is system
    memory. `format=nv12` is not optional: without it ffmpeg picks `yuvj420p`
    and the two backends would disagree on colour range.

`npm run verify:capture` is the guard. It drives the real `probeCapture` and
`ScreenSource` and fails if either the backend or the rate regresses.

**The follow camera's judder was not what it looked like.** The handoff blamed
10Hz linear sampling. Measured as per-frame acceleration over real takes with
every shot forced to follow, the camera was 30x rougher than the path it
follows — rms 18.2 against 0.59, max 321.6px in a single frame. That is a
teleport, not a kink, and it was two bugs of the same kind: the follow grid was
laid out from the waypoint's nominal `tMs` while its in-keyframe is emitted
`zoomInOverlapMs` later, so samples ran underneath the zoom-in and one landed on
exactly its timestamp; and the in-keyframe's centre was read from the path at
the waypoint's time rather than at the time the camera actually arrives. Fixed,
measured rms 1.20 / max 12.4. The 10Hz interpolation IS the remaining term and
it is small — the trade-off table is in the `FOLLOW_SAMPLE_MS` comment, and the
constant stays at 100.

**Waypoints that double back are dropped when the trip costs more than it
shows.** Over the 13 takes on disk, 12 of 17 interior triples reverse direction,
median detour 728px. Most are fine — the camera rests three to five seconds. The
guard fires only when what is left of the gap after paying `panMs` is under
`minDwellMs` AND the waypoint is on screen from both neighbours, so nothing that
happened stops being shown; only the trip goes. It removed 2 of the 12.

`docs/superpowers/plans/2026-09-07-camera-feel-handoff.md` is now largely
history — its three preview routes were overtaken by a fourth (the `<video>`
source), and its motion-blur recipe has shipped. Keep it for the stateful
decoder it warns against retrying.

**The 2026-09-08 session, in one line: the preview is fixed, the camera no
longer staggers, and every fix was found by measurement rather than taste.**

**The preview is fixed. It runs at the take's own frame rate.**
`npm run bench:preview -- 2026-09-07T17-22-48 6000 5` went from **median
10.2fps, spread 9.2-13.2** to **median 29.7fps, spread 29.5-30.0** on a take
captured at 32.6fps — about 91% of the source rate, which is the ceiling,
because rVFC fires once per presented frame. p95 frame gap fell from 215-279ms
to 49-56ms.

**Camera work can be judged in the editor again.** The instruction to judge it
only on an export is withdrawn.

The fix was not a faster decoder. The preview now draws from an
`HTMLVideoElement` and the browser owns demux, buffering and frame timing;
export keeps the decoder because it needs frame-exact random access. See
`docs/specs/2026-09-08-preview-frame-source-split-design.md`.

The `minRecoveryMs` lever that document's predecessor called "not taken" HAS
now been taken — shots chain at 1500ms and pan between focus points on their
own curve.

Phase A replaced the old "phase 9 — cursor shapes" item. The remaining work is
tracked as phases C–F in
`docs/specs/2026-09-04-composition-and-camera-design.md` §13, plus webcam PiP
(the old phase 8), which is untouched and independent of all of them.

**Next (2026-09-18): finish phase E's open review fixes, drive it by hand,
merge it, then webcam PiP or phase G.** The ordered list is in
`docs/DEVELOPER-GUIDE.md` §9.

## What this is

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio equivalent, for personal use. Read these two, in order:

1. `docs/specs/2026-09-03-screen-recorder-design.md` — design and decision log
2. `docs/superpowers/plans/2026-09-03-zoomcast-phases-0-5.md` — the 20 tasks
   covering phases 0–5. Phases 6–7 were sketched at the end of that plan and
   then built directly; there is no separate plan document for them.

## Start of session checklist

```powershell
cd C:\dev\zoomcast
npm test              # 521 passing, 51 files
npm run typecheck     # silent
npm run build         # three bundles
npm run verify:decode # 6/6, k=0 wins each time
npm run verify:parity # 30/30 at 43-47dB, over six configurations (builds first)
npm run tune -- all   # zoom plan over every take on disk
npm run verify:capture # ddagrab at ~55fps; fails on a fallback to gdigrab
```

Everything runs **natively on Windows in PowerShell**. Not WSL — Electron,
`uiohook-napi` and DXGI are Windows-only. (This project was in fact driven from
WSL via `powershell.exe`, which works, but is not the intended setup.)

## Using it

Installed: **zoomcast** in the Start menu. `npm run dist` builds the installer
to `release\zoomcast Setup <version>.exe`; it installs per-user (no admin),
makes Start menu and desktop shortcuts, and ships an uninstaller.

From source: `npm run build` then `npx electron .`

The app lives in the tray. **Start with Windows** is a checkbox in the tray
menu, off by default — with it on, Windows launches zoomcast hidden at login
(`--hidden`), so the hotkey is live with no editor window. Closing the editor
does not quit; **Show editor** brings it back, creating a window if none is
left. Quitting is explicit, from the tray.

ffmpeg is **not bundled** — the installed app finds it on PATH exactly as the
dev build does, so a machine without ffmpeg installs fine and then fails to
record.

Press **Ctrl+Alt+Z** anywhere → 3-2-1 countdown → red border while recording →
press again to stop → the editor opens the take with zooms already planned.

Zoom pacing is set in `src/shared/zoom/config.ts`, tuned against the 35s take
under `%LOCALAPPDATA%\zoomcast\recordings\`. `npm run tune` replays any take
through the planner and prints what the plan looks like — use it before
touching a dial, and after.

In the editor: **space** plays/pauses, **drag the timeline** to scrub, **←**
goes back to the recordings list, **export…** writes an MP4 with mixed audio.
The right-hand panel re-plans keyframes live as you change values.

Recordings land in `%LOCALAPPDATA%\zoomcast\recordings\<id>\`.

## Status

Recording → editing → export works end to end on real footage. No fixture is
required anywhere in that loop; `npm run fixture` still exists for the test
suite and reproducible manual testing.

Verified on a real take: mic and system tracks at 48kHz Opus with correct
negative offsets, 232 real telemetry events, and an export producing a
1920×1080 H.264 + mixed AAC clip whose frames match the preview.

The planner has now been tuned against real footage rather than fixtures. On
the 35s take it plans 6 zooms at 10.3/min, 62% of the take zoomed, shortest
hold 1.40s, shortest gap 1.00s — where the old defaults gave 8 zooms at
13.7/min including one held 0.89s against 1.2s of transition and one starting
0.14s after the previous ended.

## What landed — phase E (2026-09-09)

Phase E is done, 12 tasks, on `phase-e-timeline-editing` (not merged to
`main`). It delivered: the `applyPlan` split into `replanFrom` /
`deriveKeyframes`; cut ids; an undo/redo history with drag-gesture coalescing
and a 100-entry cap; pure segment and cut edit operations (`edits.ts`) with
their invariants; one mutation seam for the editor
(`useProjectHistory`/`edit.apply`) with history behind it; a timeline split
into ruler, zoom and cut lanes; draggable and resizable zoom segments; real
drag-to-create cut regions, replacing the old "cut 0.5s here" button; a
per-shot popover for depth and camera, replacing the inspector's "selected
shot" section; and Ctrl+Z / Ctrl+Shift+Z / Delete / Escape.

**Phase E's entire pointer/UI layer has never been run.** This is not a
footnote. No `.tsx` file in this repo is reached by any test — the vitest
suite has no React harness — and the brief's "verify by hand" step was
skipped in tasks 10, 11 and 12 because no agent in that run could launch
Electron. Every gate that *can* run mechanically (tests, typecheck, build,
decode parity, preview/export parity, capture rate, tune) is green and
unchanged, and none of them exercises a pointer event, a drag, or a
keystroke. Before phase E is trusted, a human needs to sit down and drive
it:

- **Cut lane** — drag on empty space to create a cut (output duration should
  shorten); drag a cut; drag one cut into another (they merge, and the merged
  cut keeps following the pointer); drag a cut's END edge a long way — it
  cannot grow past half the remaining lane, a known consequence of drawing a
  source-width region on an output scale (see `cutResizeToSource` in
  `src/shared/project/edits.ts`), and it needs a human's judgment on whether
  that limit is tolerable.
- **Zoom lane** — drag and resize a segment, including across a cut.
- **Popover** — select a shot, press a depth preset (the preview should
  change immediately and the badge should track it), and confirm "reset to
  auto" returns a dragged shot to planner control.
- **Shortcuts** — Ctrl+Z undoes a whole drag in ONE press, not one
  pointermove at a time; Ctrl+Shift+Z redoes; Delete removes the selection
  and undoing the delete restores it **selected**; Escape clears the
  selection and closes the popover.

## What landed 2026-09-08

Every item below was found by measuring, and several first attempts were
**wrong and caught by the numbers** — that is the method, not an accident.

| Change | The measurement that drove it |
| --- | --- |
| Preview draws from an `HTMLVideoElement` | `bench:preview` median 10.2 → 29.7fps, spread 9.2-13.2 → 29.5-30.0 |
| `zc://` honours HTTP Range | Chromium seeks by range request; without it a media element buffers the whole take |
| `FrameSource` split | Export keeps the decoder: it needs frame-exact random access, which a `<video>` cannot give |
| `cameraZoom` easing | `screenStudio` is an ease-OUT and left rest at peak speed: 0.05px one frame, 93px the next |
| `minWaypointGapMs: 900` | Two waypoints 260ms apart with a 0.667 depth gap = 190px in one frame |
| Pull-out moved off the segment end | `trailMs` 400 < `transitionOutMs` 1000, so the camera left 600ms **before** the last click |
| `maxZoom` 1.6 → 2.0 | Isolated as pacing-neutral first; a click zoom now lands at 1.917x |
| `lateralAuthority`, smoothstepped | Below `1/paddingFactor` the clamp, not the camera, chose the framing: 28.8px lateral reversal mid-zoom → ~2.5px |
| `zoomInOverlapMs: 500` | Recordly's constant; a FLOOR relative to region start, not an increment |

**Three things were tried and rejected by measurement, not opinion:**

- Raising `trailMs` to fix the early pull-out **merged shots** — one take went
  7 zooms to 3. The fix moved the keyframe instead.
- Clamping `cx` against `focusBoundsFor` to fix the lateral wobble was a
  **no-op**: `focusRange` is derived from the same expression as the quad clamp.
- Bundling `ffmpeg-static` **broke capture**. Its 6.1.1 *essentials* build has
  `ddagrab` but not `scale_d3d11`, and `probeBackend` only checks the former,
  so it passed the probe and then produced no frames. Reverted; replaced with a
  startup capability check over the whole filter list.

**`verify:parity` is now 30 comparisons, not 25** — a `blurred` configuration
was added, because every other config took the `u_blurPx <= 0` branch and the
whole motion-blur pass was rendering unguarded.

## What is NOT built

Phases D and E are built (E on its branch). F and G are specified in
`docs/specs/2026-09-04-composition-and-camera-design.md` §13 and have no
written plan yet.

Four plans are done and merged:
`2026-09-06-phase-c-export-diagnostics.md` (tasks 1–6; task 7 is open but its
subject, the head-of-file jump, was root-caused and fixed independently),
`2026-09-06-capture-frame-rate-and-settings.md` (tasks 1–6; task 7, ddagrab,
is deliberately open), `2026-09-06-phase-c-camera.md` (all 8 tasks) and
`2026-09-07-follow-camera-handoff.md`. Phase C, the camera geometry and depth
rework and the per-segment camera switch all reached `main` together on
2026-09-07 — 21 commits, fast-forward, green on the merged tree.
`docs/superpowers/plans/2026-09-05-phase-b-handoff.md` is now history — its
review happened, its fixes landed, and its three blocking questions were
answered.

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| C | Persisted zoom segments, follow-cursor camera, retuned transitions, preview performance — **done** | A, B |
| C+ | Camera geometry (fixed frame, sampled region), configurable ceiling, depth grading — **done**, spec `2026-09-07-camera-geometry-and-depth-design.md` | C |
| C+ shots | Per-segment camera switch: segment blocks in the timeline, `fixed`/`follow` in the inspector — **done**, plan `2026-09-07-follow-camera-handoff.md` | C+ |
| D | Directional motion blur — **done** 2026-09-08, off by default (`style.motionBlurAmount`) | C |
| E | Draggable zoom segments, segment/global popover, real cut regions, undo/redo, keyboard shortcuts — **done** on branch `phase-e-timeline-editing`, unverified by hand | C |
| F | Clip speed — reverses v1 decision #9; abandoning it is an acceptable outcome | E |
| G | **UI revamp** — the whole editor surface, once the features it has to present are known. Requested by the user; deliberately placed after E so it revamps a finished feature set rather than a moving one. No spec section yet. | E |

**Export is now diagnosable.** `export:start` logs the resolved settings,
`export:finish` logs success or the failure with ffmpeg's stderr tail, and
`exportCancel` takes a required reason — cancel is the only path that truncates
a file. Exporting also writes `project.json`, so a bundle can be re-exported
identically. Both live in `%APPDATA%\zoomcast\main-error.log`.

**Encoders measured** (`npm run bench:encoders`, 600 frames of 1080p60, encode
only): libx264 47.6fps / 0.79x realtime, **h264_amf 88.7fps / 1.48x realtime**.
h264_amf is ~1.9x faster, so the export button's choice is right. The note's old
"~8fps, 0.13x realtime" claim was wrong by roughly eleven times; every inference
that rested on exports being multi-minute is void. `h264_amf` now has an
automated guard: the export e2e runs over every encoder ffmpeg reports.

**Open bug: export produced a truncated mp4 once, and has not reproduced.**
On 2026-09-06 the same take exported cleanly through the real button — the
`h264_amf` path — at 1606 frames in ~50s, and the file plays. So the encoder
has now been exercised in anger successfully, and the note's old "~8fps, 0.13x
realtime" figure is contradicted by a measured ~32fps; do not carry it forward.
The truncation remains unexplained. Full state, including what the user's own
answers ruled out, is in
`docs/superpowers/notes/2026-09-05-export-truncated-bug.md`. **Read that file
before touching the export path.**

The app still records nothing about an export — not the failure, not the
settings — which is why that investigation has restarted from zero twice.
`docs/superpowers/plans/2026-09-06-phase-c-export-diagnostics.md` is the plan
that fixes it, and it is unstarted.

**Fixed 2026-09-06: the head of an exported file jumped.** The first ~1.03s
rendered full-bleed and then the picture moved 229px in one frame. Root cause
was the `screenQuad` clamp discontinuity described under "Camera geometry"
below — not the planner, not the easing, and not the VFR capture, all of which
were measured and cleared.

**The zoom complaint is measured**, with a specific signature, in
`docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md` — read that
before touching a pacing dial. Phase C addressed two of its three causes; see
"Is 'floaty and laggy' fixed?" below for which, and on what evidence.

**Spec §8's shared-path claim was false and is now fixed.** It said the cursor's
position "comes from the same smoothed path the camera uses (§9), so cursor and
camera cannot disagree", but `buildCursorPath`'s only damping input was
`smoothing`, a presentation control the user can set to 0, capped at a 90ms
cursor-scale half-life. `PathOptions` now takes `halfLifeMs` directly and the
0–1 mapping (`smoothingToHalfLife`) is applied at the Editor call site, so the
two share one function evaluated at two half-lives. §8 says so.

**Webcam PiP** (the old phase 8) is independent of all of it: a third
`MediaRecorder` following the same hidden-renderer pattern as `AudioRecorder`, a
second `VideoSource` in the editor, the webcam pass in `Renderer`
(`FrameState.webcam` already exists), placement UI. It will need
`registerDisplayMediaHandler()` treatment for `getUserMedia`.

Also worth doing early:

- **Surface the `unclean` state.** A recording that ended abnormally is marked
  in the manifest and logged, but the Welcome list does not show it.
- **Delete recordings from the UI.** The list shows sizes; there is no delete.

## Resolved 2026-09-08: ddagrab did not work on this machine

> Historical. ddagrab works now — the cause was the GPU preference, see the
> top of this file and `src/main/capture/gpuPreference.ts`. Kept for the
> diagnosis record.

The spec was built around DXGI Desktop Duplication (`ddagrab`) for zero-copy GPU
capture. **It does not work here** — but the diagnosis is more specific than
what this section said until 2026-09-06, which was that neither adapter
enumerates an output:

| adapter | output | result |
| --- | --- | --- |
| 0 (AMD, drives the panel) | 0 | **`Selected output not supported`** |
| 0 | 1 | `Failed to enumerate DXGI output 1` — correct, one display |
| 1 (NVIDIA RTX 3050) | 0 | `Failed to enumerate DXGI output 0` — normal, no display attached |
| 2 | any | no such adapter |

The panel's output **is** enumerated; ddagrab rejects that specific output.
Pixel format is ruled out: `output_fmt` of 8bit, `auto` and `x2bgr10`, with and
without `scale_d3d11` to nv12 or p010, all fail identically on ffmpeg 9.0.1.

The untested suspect is Windows' per-application GPU preference — on MSHybrid
laptops Desktop Duplication fails with exactly this error when the calling
process is bound to the GPU that does not own the output. Try pinning
ffmpeg.exe to "Power saving" in Settings → Display → Graphics, which is
reversible and needs no elevation, before touching
`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. Full write-up in
`docs/superpowers/plans/2026-09-06-capture-frame-rate-and-settings.md` Task 7.

`probeBackend()` in `src/main/capture/ScreenSource.ts` tries `ddagrab` first and
falls back to `gdigrab`, so this is transparent downstream: the manifest records
`"adapter": "gdigrab"` and the **measured** fps rather than the requested one
(gdigrab managed ~26–29fps against 30 requested here). If you get `ddagrab`
working — the untested variable is running ffmpeg from a terminal you opened
directly rather than through WSL interop — the probe picks it up with no code
change and you get 60fps GPU capture for free.

## Verification tools

Things checkable without watching a window. Each was written after a bug that
unit tests could not have caught.

| Command | Checks |
| --- | --- |
| `npm run verify:decode` | Every seek returns the frame that actually sits at that timestamp |
| `npm run verify:parity` | Preview and export render identically, across six configurations (default, styled, 1:1, blurred, follow, hidden) — 30 comparisons. It carries more weight since 2026-09-08: the two paths now DECODE differently, so this is what proves they still compose the same |
| `ZOOMCAST_SHOOT` | Renders arbitrary frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` | Opens a bundle in the real editor and captures the window |
| `ZOOMCAST_RECORD_TEST=<seconds>` | Full record→stop cycle headlessly; result to `%APPDATA%\zoomcast\record-test.json` |
| `ZOOMCAST_RECORD_TEST_RUNS=<n>` | n recordings in **one process**, each reporting `hasCursorShapes` and its cursor-event count. Use 2+ for anything touching process-global state — see the koffi entry below |
| `npm run bench:preview -- <take> [ms] [runs]` | What the preview actually achieves while playing. **~29.7fps** on a take captured at 32.6fps, p50 35ms, p95 ~50ms. The source rate is the ceiling |
| `npm run tune -- <take\|all>` | Replays real recordings through the planner: zoom count, pacing, holds, gaps, travel, and the cluster funnel |
| `npm run camera:travel -- <take>` | How far the camera moves DURING a hold, fixed vs follow. Fixed is 0px/s — it arrives and freezes |
| `npm run render:camera -- <take>` | Renders a take twice, every zoom fixed then every zoom following, to watch side by side |
| `ZOOMCAST_UI_SHOT_JS` | JS run in the editor after it settles, before the capture — the only way to photograph a state that takes a click to reach |
| `npm run icon` | Redraws `build/icon.ico` from `tools/make-icon.ts` |

The record test is the best check on a packaged build, because it exercises the
native addon, the tray and the hotkey inside the real installed layout:

```powershell
$env:ZOOMCAST_RECORD_TEST = '5'
.\release\win-unpacked\zoomcast.exe | Out-Null
cat "$env:APPDATA\zoomcast\record-test.json"
```

```powershell
# compositor stills
$env:ZOOMCAST_SHOOT = (Get-Content -Raw tools\shots-spec.json)
$env:ZOOMCAST_SHOOT_DIR = 'C:\dev\zoomcast\tmp\shots'
npx electron .

# editor screenshot at a chosen playhead (a blank bundle shows the Welcome screen)
$env:ZOOMCAST_UI_SHOT = 'C:\dev\zoomcast\tests\fixtures\basic'
$env:ZOOMCAST_UI_SHOT_SEEK = '4600'
$env:ZOOMCAST_UI_SHOT_OUT = 'C:\dev\zoomcast\tmp\ui\editor.png'
npx electron .

# headless record test — proves capture end to end without clicking anything
$env:ZOOMCAST_RECORD_TEST = '5'
npx electron . | Out-Null
cat "$env:APPDATA\zoomcast\record-test.json"

# main-process diagnostics — logDiag output, since Electron's stdout on
# Windows does not reach the launching shell
cat "$env:APPDATA\zoomcast\main-error.log"
```

## The camera (phase C)

Segments are now the persisted, editable unit and keyframes are derived from
them. `planZoom` returns `ZoomSegment[]`; `segmentsToKeyframes` turns them into
what renders. Nothing else in the pipeline moved: `tune -- all` was
byte-identical across that refactor, which is the guard that pacing did not
shift.

- `src/shared/zoom/types.ts` — `ZoomSegment`, `ZoomWaypoint`.
- `src/shared/zoom/keyframes.ts` — segments → keyframes, the opening-at-rest
  rule, the follow sampling, `depthToScale`/`scaleToDepth`.
- `src/shared/zoom/camera.ts` — `followPath` and `clampToSource`.
- `src/shared/zoom/replan.ts` — `replanSegments` alongside `replan`.

Things worth knowing before touching it:

- **A segment carries its waypoints.** The spec's §6 sketch had one centre per
  segment; the pacing guards merge two zooms less than `minRecoveryMs` apart
  into one segment that stays in and pans, and 5 of the 10 takes on disk
  contain one (one has three waypoints). Splitting them into separate segments
  would make "stay in" emerge from two times being exactly equal, and one drag
  in phase E's timeline would bring back the flinch the guard prevents.
- **`depth` is 0–1 against the derived ceiling, not a scale.** The ceiling comes
  from the output size, so a stored absolute scale is wrong the moment the
  aspect changes.
- **Every take opens at rest.** A keyframe at `t = 0` cannot be eased into, so
  takes used to open on a hard cut. Any keyframe whose transition would start
  before zero moves to `transitionMs` — it is never given a shorter transition,
  which would make the opening move the fastest in the take. The segment pays
  for that by ending later too, clamped to the next segment's recovery gap;
  without that the opening zoom's hold fell under the `transitionMs * 2` floor
  `enforceDwell` exists to keep.
- **Follow is precomputed, never integrated per frame.** `followPath` is the
  cursor's own function at a 300ms half-life on a fixed grid. Per-frame
  integration would make a 60fps preview and a 30fps export disagree, and
  `verify:parity` would be right to fail. A follow segment emits a keyframe
  every 100ms with a linear ramp between them, so what renders is the
  precomputed path rather than the output frame rate.
- **Two paths built at different `sampleHz` do NOT agree exactly**, because the
  grid also quantises when a telemetry target changes; exponential decay
  composes exactly only while the target is constant. The property parity
  actually needs — one precomputed array read at any rate — does hold, and is
  the test that guards it.
- **Follow works at every aspect now.** It used to be inert at 16:9: nothing
  cropped below `1 / paddingFactor`, which was exactly where the ceiling landed,
  so the camera had no viewport to move. Every scale above 1 crops since the
  geometry rework, so `cx`/`cy` matter everywhere and `clampToSource` is a
  two-line derivation of `sourceRectFor` rather than its own copy of the
  arithmetic.
- **Follow is opt-in and the planner never emits it.** It survives the re-plan
  the editor runs on load only because `replanSegments` keeps pinned and manual
  segments, which is spec §6's contract one level up from `replan`.

**What follow is and is not guarded by.** `verify:parity`'s fifth config pins a
follow segment at 1:1 and is 30/30, and its frames differ both from the square
config and from each other over time, so the camera is provably moving rather
than silently falling back. What is NOT guarded: follow at the native aspect
(there is nothing to guard — see above), follow across a cut, and any UI for
turning it on. **The control for `position: "follow"` landed 2026-09-07**:
shots draw as blocks in the timeline, clicking one selects it, and the
inspector's "selected shot" section switches its camera. The choice rides
across every later re-plan by segment id — it does NOT pin the segment, so the
shot still re-plans its times when a pacing dial moves. Dragging edges, adding
and deleting segments and per-segment depth are still phase E.

### Zoom is a camera now, not a scale

Until 2026-09-07 zoom meant "grow the screen rectangle until the output frame
crops it". Two things followed, both visible in the export of that morning:
the entire zoom range was 1.0–1.176x — exactly the padding — and at the top of
it the quad covered the output, so `cx`/`cy` clamped to dead centre and the
camera had no freedom at all. Hence "it feels like the screen is being scaled".

The frame is now fixed and the **sampled source region is the camera**.

| Piece | Where |
| --- | --- |
| `screenQuadFor(source, output, padding, zoom)` | `src/shared/zoom/viewport.ts` — the camera and its clamp. In shared, not the renderer, because `clampToSource` needs the same clamp |
| `focusBoundsFor(...)` | same file — which focus centres the quad will not clamp. Clamping the quad is **not** a fixed point in `cx`, so the follow path is clamped in `cx` directly |
| `sourceToFrame(p, rect, frame)` | same file — the ONE mapping, used by screen, cursor and ripples. Product code passes `WHOLE_SOURCE`: the zoom is in the quad |
| `screenQuad(source, output, padding, zoom)` | `src/renderer/gl/layout.ts` — a thin delegate to `screenQuadFor` |
| `zoomDepth(inputs, cfg)` | `src/shared/zoom/depth.ts` — how deep, from intent and spread |

Things worth knowing before touching it:

- **In `src/shared/`, not the renderer, deliberately.** The spec put the
  geometry in `layout.ts`; `clampToSource` lives in shared and cannot import
  from renderer, so that would have forced a second copy of the clamp. One
  implementation, and `clampToSource` derives from it.
- **`sourceToFrame` returns `null` when a point is off screen**, and the cursor
  and ripple passes skip it. They also need `withFrameClip`, because the frame
  no longer reaches the output edge and nothing else would crop an overlay
  overhanging it. That helper is the ONE place a bottom-left origin appears —
  `gl.scissor` measures from the bottom while everything else here measures
  from the top. The scissor box is rectangular and the frame has rounded
  corners, so an overlay can still show over a corner cut; accepted, not masked.
- **The ceiling is a sharpness choice.** `maxZoom` defaults to 1.6. Because the
  frame is inset by `paddingFactor`, that upscales the source by 1.36x, not
  1.6x — checked on a 1:1 crop of a real export, where text stays readable with
  the existing sharpen pass. `pixelParityZoom` is where upscaling starts and is
  reported in the timeline as "sharp to".
- **Look for the second cap. This codebase has hit it twice.** First
  `fitScale` carried its own clamp at pixel parity, so raising the ceiling
  changed nothing and `tune` came back byte-identical. Then the intent bases
  were absolute — a click base of 1.55 against `min(base, pullback)` meant
  every `maxZoom` above 1.55 produced 1.55, and the one depth dial the UI
  exposed was inert. The bases are now **fractions of the ceiling**, the same
  0..1 relative form `ZoomSegment.depth` uses, so one dial deepens everything
  and the grading survives. If a depth change has no visible effect, something
  downstream is clamping it.
- **Depth grading: intent sets the base, spread only pulls back.** Measured, not
  stylistic: of 54 clusters that earn a zoom across every take on disk, 29 have
  zero spatial spread and 38 are under 200px. There is nothing to grade on for
  most zooms, so intent has to carry it. `contextFraction` is 0.8, chosen
  because 0.6 and 0.8 drop the same single zoom on real footage while 0.6 also
  rejects anything spanning 0.625 of the screen — which is the shape of the
  test fixture, and would have stopped four of parity's five configs exercising
  the zoom path at all.
- **`Impulse.kind` is not `Impulse.w`.** The weight gates `minWeight`, which
  decides whether a cluster earns a zoom AT ALL; the intent weights decide how
  deep it goes. They are separate config so tuning depth cannot silently change
  how many zooms there are.
- **Target size is a seam, not a dependency.** `DepthInputs.targetSize` is
  optional and absent, and absent means "no constraint", never "size zero".
  Getting real element bounds needs UI Automation over COM or CV on the frame;
  spec §8 has the analysis. Judge the exports first.

### What is NOT fixed by this

**The preview decode cost is unchanged.** Advancing one source frame still
decodes from the nearest keyframe — GOP is 30, so ~15 frames on average. Three
watchable improvements landed here; a fourth did not. If the preview still
stutters, that is why, and a stateful incremental decoder for sequential
playback is the fix.

### The transition curve

The measured signature of the old curve, `zoomEase` = `cubicBezier(0.33, 0,
0.1, 1)`: 61% of the motion in the first third, 6% in the last, peak velocity
at 23% of the way through. At 600ms it is 95% arrived after 416ms and then
drifts for 184ms. That drifting tail is what "floaty" describes.

`zoomGlide` = `cubicBezier(0.45, 0.05, 0.55, 0.95)` is 23 / 50 / 23 across the
thirds, peaks in the middle, and has the lowest peak speed of the curves tried
(2.88×/s against 5.29×/s), so a longer transition reads as gentler rather than
slower.

| variant | halfway | 95% done | drifting tail | peak speed |
| --- | --- | --- | --- | --- |
| ease 600ms (old default) | 172ms | 416ms | 184ms | 5.29×/s |
| glide 600ms | 300ms | 513ms | 87ms | 2.88×/s |
| glide 900ms | 450ms | 770ms | 130ms | 1.92×/s |

**Superseded 2026-09-07 by a measurement of the reference the user actually
wants.** They pointed at a Recordly export and said "how smooth and clean it
is". Measured off that video and then confirmed in Recordly's source, where the
function is called `easeOutScreenStudio`:

| variant | window | 95% done | drifting tail | thirds |
| --- | --- | --- | --- | --- |
| glide 600ms | 600ms | 513ms | 87ms | 23/53/23 |
| ease 600ms | 600ms | 416ms | 184ms | 61/33/6 |
| **screenStudio** `cubic-bezier(0.16, 1, 0.3, 1)` | **1523ms in / 1015ms out** | 648ms | **875ms** | **90/9/1** |

So the tail was never the problem. zoomGlide was chosen because zoomEase's
184ms tail was blamed for "floaty"; the reference has a tail **ten times
longer** and reads as smooth. What it does differently is commit — 90% of the
motion in the first third — and then settle almost invisibly. **`screenStudio`
is the default since 2026-09-07.** All three stay pickable in the inspector.

Renders are in `tmp/pacing/<take>/{a-before-glide-600,b-after-studio}/`, built
by `tmp/render-pacing.ts` (throwaway; `tmp/` is gitignored). The older curve
renders are in `tmp/curves/<take>/<variant>/` from `tmp/render-curves.ts`.

### What else the reference measurement said

Measured from a 45.1s Recordly export, and cross-checked against its source:

| | Recordly | zoomcast before | zoomcast after |
| --- | --- | --- | --- |
| take spent zoomed | 28% | 52-64% | 52-64% (see below) |
| shots per minute | 6.6 | 6.5-8.9 | unchanged |
| depth | 1.5 flat | 1.15-1.55 graded | unchanged |
| hold bounds | 450-2600ms, and NOT a zoom-length cap | min only | `minDwellMs` 1450, still no maximum |
| pan during a hold | **~0-1px/s** | 0px/s | 0px/s |

Two things worth keeping in mind:

- **The reference does NOT pan during a hold either.** Its camera arrives and
  freezes, exactly like `position: "fixed"`. Whatever makes it read as smooth,
  it is not a follow camera — so do not reach for follow to chase this look.
- **There is deliberately no cap on how long a zoom holds, and adding one was
  a mistake.** `maxDwellMs` shipped for about an hour on 2026-09-07 and was
  removed the same session. Recordly's `MAX_DWELL_DURATION_MS` filters
  cursor-DWELL CANDIDATES — "a run of stillness longer than 2.6s is not a
  dwell signal" — and says nothing about zoom length; reading it as a cap was
  the error. A segment already ends at the activity's end plus `trailMs`, so a
  long segment means a long burst of activity. Capping it pulled the camera
  out at 6.62s on a real take **exactly as a 26-second typing run began**, and
  nothing re-engaged because the cluster was spent. It also left segments
  holding waypoints beyond their own end.
- **So the 28% figure is not a target to engineer toward.** It came from one
  45s clip of someone else's content. What is transferable is the CURVE and
  the transition windows, which are properties of the tool; how much of a take
  is zoomed is a property of what the take contains.

### Is "floaty and laggy" fixed?

Four causes now — the fourth was found by watching an export rather than
reasoning about the complaint. Three are addressed; one is not.

1. **The drifting tail** — this diagnosis was WRONG, and was corrected on
   2026-09-07 by measuring the reference the user actually wants. A long tail
   is fine; the reference has an 875ms one. `screenStudio` is the default now.
   See "The transition curve" above.
2. **The zoom itself did nothing** — this turned out to be the big one, and it
   was not on the original list. The whole zoom range was the 15% padding, and
   at the top of it the camera was mathematically pinned to centre. Fixed by
   the geometry rework above: the camera now crops toward the pointer, up to a
   configurable 1.6x, at a depth that varies with what you were doing.
3. **The preview stutter** — MEASURED, then FIXED on 2026-09-08. It reported
   **~13fps** and was the thing the user actually saw; judging camera work in
   the editor was judging the decoder, which is exactly what happened on
   2026-09-07 when "the travel is lagging and glitchy" turned out to be partly
   a real 495px camera teleport and mostly this.

   **The cause was never decode speed.** `VideoDecoder` is Chromium's hardware
   decoder. `frameAt` built a fresh one per frame and decoded from the nearest
   keyframe, so against a GOP of 30 it paid ~15 decoded frames for every one
   displayed. The preview now draws from an `HTMLVideoElement` instead, which
   deletes both that amplification and the feedback loop below rather than
   solving either. Median 10.2 -> 29.7fps. Export still uses the decoder.

   **Two traps in that harness, both hit on the first attempt.** A hidden
   BrowserWindow throttles `requestAnimationFrame` to about 1Hz, so the first
   run reported "1.0fps" — an artifact, not a measurement; the bench window is
   shown and `setBackgroundThrottling(false)` now, and it warns when the tick
   count implies throttling. And the result moves a lot between machine
   states: 9.6 and 20.7fps were both measured on the same code and take,
   while back-to-back runs sit within a few percent. **Compare a batch
   against a batch.**

   **A stateful incremental decoder was tried on 2026-09-07 and REVERTED.**
   Kept here because it explains why the fix took the shape it did, not
   because it is still worth retrying — the `<video>` path made it moot.
   Keeping a `VideoDecoder` alive across frames and feeding it only the chunks
   between two positions took the preview from ~13fps to **1.5fps**, with
   `fastHits: 0` — the fast path never once produced a frame, so every draw
   paid for the failed attempt AND the full-GOP fallback. Two things to know
   before trying again: after `flush()` a decoder did not usefully accept
   further delta chunks here, and there is a feedback loop — the playhead
   follows the wall clock, so a slow draw advances it about a second, which is
   ~60 frames at 60fps, which is past the next keyframe, so the incremental
   path cannot engage during playback even when it works. Any retry has to
   break that loop, not just keep a decoder warm.

   The original note read: improved, not measured. The playhead no longer
   re-renders the editor 60 times a second, and the decode for the next source
   frame now happens in the gap after a draw instead of on the critical path.
   What did NOT change is the cost of that decode: every seek decodes forward
   from the nearest keyframe, GOP is 30, so advancing one source frame still
   costs ~15 frames of decode on average. A stateful incremental decoder for
   sequential playback is the real fix and is not in this phase. **No preview
   frame-rate harness exists**, so "smoother" here is a design argument, not a
   measurement — the honest next step is to build one before claiming it.
4. **The source frame rate** — not fixable in software, and must not be
   reported as fixed. Measured with `ffprobe -count_frames` over all twelve
   takes on disk: the 2026-09-05 takes ran at 11.6–21.7fps, and the takes after
   the capture-rate work at 27.1–30.2fps. Real 60fps needs `ddagrab`.

While measuring that: **`manifest.video.fps` is trustworthy.** It comes from
`avg_frame_rate`, which the phase C plan warned is a nominal container rate,
but on every finished take it agrees exactly with a `-count_frames` count. The
editor's status line now shows it as "captured at N.Nfps" rather than
`30.227272727272727fps`.

## The compositor (phase B)

`drawFrame` runs background → shadow → screen → ripples → cursor. Phase B
widened the first three rather than adding passes.

- `src/shared/style/backgrounds.ts` — six mesh gradient presets as pure data,
  plus `gradientPreset()` and the blur LOD table.
- `src/shared/style/frame.ts` — `FRAME_PRESETS` and `resolveFrame`.
- `src/shared/style/aspect.ts` — `outputSizeFor`.
- `src/renderer/gl/backgroundTexture.ts` — image decode, mipmaps, cover-fit size.
- `src/renderer/ui/StylePanel.tsx` — background, frame and output controls.
- `src/renderer/ui/controls.ts` — the four shared control styles.

Things worth knowing before touching it:

- **Every frame read must go through `resolveFrame`.** Reading `style.frame.*`
  directly makes the presets silently do nothing, because "minimal" and
  "hidden" override the individual fields while "default" defers to them.
- **`outputSizeFor` has THREE call sites, not two.** Preview, export, and the
  planner context — the zoom ceiling derives from output size, so a re-plan
  after an aspect change would otherwise plan for the old shape.
- **Kind-specific controls are hidden for a reason, not for tidiness.** Under a
  non-default frame preset the individual fields are ignored, so an editable
  control there would silently do nothing.
- **Blur is image-only, and that was measured.** RMS difference out of 255:
  mesh none→strong is 0.108 (a no-op — the mesh is smooth by construction),
  image none→strong is 4.586.
- **Blur is a mipmap LOD, not a kernel.** The first attempt was a 3x3 kernel;
  at "strong" its taps land 27px apart, so a grid image rendered as three
  distinct copies rather than one soft one. Nine taps cannot represent a 27px
  radius. `textureLod` against a mipmapped texture is one fetch, correct at any
  radius, and resolution-independent because LOD is relative to the texture.
- **The border is a ring inside `SCREEN_FRAG`'s existing SDF.** Drawn as its own
  quad it would square off the corners, because only that shader knows where the
  rounded edge is.
- **A background image is copied into the project directory, never referenced**
  (spec §5), and addressed as `zc://app/@fs/...` through `bundleAssetUrl` —
  one helper, because there are three `drawFrame` call sites.
- **Export and shoot must `preloadBackgroundImage` before their loop.** Both
  draw each frame once with no repaint, so a frame that fell back to the solid
  colour while the image decoded is baked into the output. Preview redraws, so
  it does not need to.
- **Mesh distances are measured in square space** via `u_aspect`, or a preset
  smears horizontally on 16:9 and vertically on 9:16.

## The cursor pipeline (phase A)

`drawMouse` stays `false` — v1 decision #6, because a cursor baked into the
pixels cannot be smoothed, resized, or kept sharp under zoom. Everything here
exists to draw it back on top, better.

- `src/main/capture/CursorShapeReader.ts` polls `user32!GetCursorInfo` at 30Hz
  via koffi and writes shape events into the telemetry stream.
- `src/shared/cursor/shapeTracker.ts` maps a cursor handle to a shape.
- `src/shared/cursor/shapes.ts` holds eight vector shapes, drawn not extracted.
- `src/shared/cursor/path.ts` precomputes the smoothed position path.
- `src/shared/cursor/ripples.ts` returns the active click ripples at a time.
- `src/renderer/gl/cursorTexture.ts` rasterises per (shape, size) and caches.
- `src/renderer/gl/Renderer.ts` draws ripples, then the cursor, over the screen.
- `src/renderer/ui/Inspector.tsx` exposes all five `CursorStyle` controls.

Two known cosmetic weaknesses, both visible in a rendered shot and neither worth
blocking on: the `wait` glyph reads as two crescents rather than a clean spinner
ring, and `hand` reads as a rounded blob at small sizes. Both are geometrically
valid paths, just not great drawings. Redraw them in `shapes.ts` if they bother
you — nothing else has to change.

## Things that will bite you

Each of these cost real time; none is hypothetical.

**Zoom planning**

- **Zoom depth is graded, and the ceiling is a setting.** Until 2026-09-07
  every zoom in every take was exactly 1.176x: the cap was
  `source.w / (output.w * paddingFactor)` and a single click asks for ~12x, so
  everything clamped. Depth now comes from `zoomDepth` in `depth.ts` — intent
  sets a base (`click` 1.55, `type` 1.35, `scroll` 1.15) and spread only ever
  pulls it back — and the cap is `ZoomConfig.maxZoom`, default 1.6.
  `pixelParityZoom` is where upscaling begins, reported in the timeline as
  "sharp to", and is no longer a cap.
- **A transition may not begin before the keyframe it departs from.**
  `zoomAt` used to run the window back past the previous keyframe, so at the
  instant the camera should have ARRIVED there it was already part-way to the
  next one, and the value jumped — the closer the pair, the bigger the jump.
  Measured over every take on disk: 9 of 134 transitions overlapped, and the
  worst single-frame camera move was **495px at 60fps**, which is a teleport.
  Clamping the window to the previous keyframe's time takes that to 85px.
  The transition is shortened rather than the keyframe moved, because `zoomAt`
  has to stay a pure function of the keyframes it is handed — including ones
  hand-written into `project.json`. Widening `minRecoveryMs` to 1500 and
  giving the pan its own 1000ms window made this common; it was always latent.
- **A pan is not a zoom, and must not share its curve.** The first waypoint in
  a shot is the zoom-in and uses `easing`/`transitionMs`; every later one is
  the camera travelling inside a shot it has already arrived in, and uses the
  fixed `cameraPan` curve over `panMs`. Measured off Recordly: their pan curve
  is 65/28/7 across the thirds at a 2.61x/s peak, against their zoom's 90/9/1
  at 4.09x/s. Sharing the zoom curve put 90% of a sideways move into its first
  third, which reads as a lurch. `cameraPan` is not in the inspector's curve
  picker for the same reason `linear` is not: it is a mechanism, not a look.
- **`minRecoveryMs` is the chain window, and 700ms was too tight.** Below it,
  two zooms stay in and pan between focus points; above it the camera pulls
  out to full screen and comes back. Recordly chains at 1500ms
  (`CHAINED_ZOOM_PAN_GAP_MS`) and ours now matches. On real takes this turns
  separate shots into waypoints: 8 zooms at 17.9/min became 4 at 9.0/min, and
  12 became 9, with coverage roughly unchanged. The zooms did not disappear —
  they became stops inside a travelling shot.
- **`maxZoomsPerMinute` is a backstop, not a pacing dial.** Turning it down
  makes the result worse: it deletes the clusters that would otherwise have
  merged into one travelling shot, leaving isolated zooms and long flat
  stretches. Pace with `minHoldMs`, `minDwellMs` and `minRecoveryMs`.
- **`payForTheOpeningMove` runs AFTER `applySegmentGuards`, so the dwell floor
  has already had its say.** It shifts an opening waypoint to `transitionMs`
  and extends `endT` to match — but that extension is clamped by the next
  segment's recovery gap, so a close-following cluster truncates it. At a
  600ms transition the shift was small and this never showed; at 1500ms
  `tune` reported a **0.71s opening zoom against a 1.0s zoom-out**, and a
  synthetic probe got it down to **150ms**. It now drops a shot with no room
  to leave, measuring from the MOVED waypoint rather than `startT` — those two
  differ only for the opening segment, which is exactly the case that broke.
- **Cluster guards cannot see camera pathologies.** `guards.ts` works on
  attention; the two things that actually make auto-zoom unwatchable are only
  visible once zoom times exist, so they are guarded in `segments.ts`: a zoom
  held for less than its own two transitions (the camera never arrives), and a
  zoom-out followed 140ms later by a zoom-in elsewhere (a flinch, not two
  shots). Both were found in real footage that no unit test would have caught.

**Capture frame rate — what it is, and what it is not**

- **gdigrab tops out around 28fps at 1080p here, whatever it is asked for.**
  Counting real frames on 2026-09-06: bare ffmpeg reaches 21.9fps at 30
  requested and 28.6fps at 60; inside the app, where ffmpeg competes with
  Electron, audio capture and telemetry, it lands at 27-30fps either way. The
  request was raised from a hardcoded 30 to a setting defaulting to 60 because
  it is never worse and sometimes better — **not** because it delivers 60.
- **Never read an achieved frame rate off `avg_frame_rate`.** It reports a
  nominal container rate. Doing so produced a confident "44fps" that was wrong
  by more than half and briefly justified this whole change on a false premise.
  Use `ffprobe -count_frames` and divide by the real duration.
- **Every take now logs `capture:rate`** with requested vs achieved, in
  `main-error.log`. Capture had the export path's blind spot: nothing recorded
  what was asked for, so a take at half the expected rate left no way to tell
  whether the request or the machine was at fault.
- **Settings live in `%APPDATA%\zoomcast\settings.json`**, normalised on load
  by `normalizeSettings` exactly as projects are. They are app-level and
  deliberately not part of `Project`: capture rate applies before any project
  exists. Anyone adding a field must add it to `normalizeSettings` too. The
  window is a `#settings` route, opened from the tray.

**Camera geometry**

- **A clamp written as two regimes is a teleport waiting to happen.**
  `screenQuad` clamped `x` to `[output.w - w, 0]` only when `w >= output.w`.
  That range has zero width at exactly `w === output.w`, so `x` was pinned to 0
  there while the unclamped value was hundreds of pixels away — and one float
  below the crossover the clamp released and the camera jumped. Measured at
  **229px in a single frame** on a real take. Worse, the crossover sits at
  `1 / paddingFactor`, which is exactly where `maxComfortableZoom` lands
  whenever output matches source, so every zoom that reached the ceiling hit
  it. Both bounds now go through one continuous `clamp(x, min(0, d), max(0, d))`.
  The continuity properties in `layout.test.ts` are what hold it closed: they
  sweep the scale and bound the per-step movement, because pinned positions
  pass happily against a curve that jumps between the pinned points.
- **The composition is INTENDED to disappear at depth.** Once the window is
  larger than the output there is no background, no border and no shadow —
  that is the reference's look, not a bug, and it is why judging the
  compositor on a zoomed take tells you nothing. Use a take at rest.
- **A clamped quad is not a fixed point in `cx`.** Reading a centre back off a
  clamped quad and feeding it in again moves the quad — measured at 135px on
  the first attempt at `clampToSource`. `focusBoundsFor` solves the bound
  analytically instead, from the same expression `screenQuadFor` uses, and
  `camera.test.ts` sweeps scales and centres asserting a second pass changes
  nothing.
- **Superseded 2026-09-07: at the zoom ceiling the composition used to be
  exactly invisible.** `1/0.85` was both the ceiling and the scale at which the screen
  filled the padded frame, so a zoomed-in take showed no background, no border
  and no shadow — and worse, the quad covered the output, so `cx`/`cy` clamped
  to dead centre and the camera was inert exactly when the zoom was deepest.
  That is why the result read as the screen being scaled rather than a camera
  moving. The frame is fixed now and the sampled region is the camera. The
  original note read: that is a design
  question for phase C, not a bug — but it means judging the compositor on a
  zoomed take tells you nothing.
- **A keyframe at `t = 0` cannot be eased into**, since its transition would
  have to start at −600ms. Takes therefore *open* at whatever scale the planner
  chose, as a hard cut on frame one.

**Headless modes and their exit codes**

- **`app.quit()` does not carry `process.exitCode`.** All four headless failure
  paths set `process.exitCode = 1` and then quit gracefully — and every one of
  them exited **0**. `verify-decode` checks `shoot.status !== 0`, so a shoot
  that threw was invisible to it. Use `app.exit(1)`, which is now what they all
  do.
- **`ZOOMCAST_SHOOT` fails loudly when a declared background image does not
  decode.** It used to fall back to the solid colour and emit a plausible PNG,
  which meant the only coverage of the image branch, the cover-fit arithmetic
  and the LOD blur could render no image at all and still look like a pass.
- **`npm run fixture` generates `tmp/bgtest.png`**, which the shot specs point
  at. It is gitignored, so before this nothing created it and every fresh
  checkout silently rendered those shots without an image.
- **`npm run verify:parity` builds first now.** It runs the BUILT bundle, and
  forgetting the build had already produced a confusing round on the phase B
  branch where a new config reported PSNRs identical to the default.

**The cursor pipeline**

- **koffi registers NAMED types in a process-global registry.**
  `koffi.struct("POINT", …)` throws `Duplicate type name` on the second call, so
  FFI setup must be memoised at module scope, never run per recording. It was
  per-recording once: the second recording of every app session threw, the throw
  was swallowed by `start()`'s catch, and the take silently carried no shape
  stream while the manifest still claimed one. zoomcast is a tray app that lives
  for days, so run 2 is the normal case. **Anything touching process-global
  state must be tested with `ZOOMCAST_RECORD_TEST_RUNS=2`** — a single-run test
  is structurally incapable of seeing this class of bug.
- **`koffi.inout(koffi.pointer(CURSORINFO))`, never `koffi.out(...)`.** `out()`
  never marshals `cbSize` *into* the call, so `GetCursorInfo` fails with
  `ERROR_INVALID_PARAMETER` on every call, silently. The stream just stays empty.
- **Allocate the `info` literal fresh inside the poll closure.** koffi zeroes
  `cbSize` when decoding, so a reused object fails from the second poll on. This
  is unrelated to the memoisation above and is still required.
- **`koffi.address()` returns `bigint`** in koffi 3.2.1. Handles are small
  (65539–65567), so `Number(...)` is lossless. Confirmed handles: arrow 65539,
  ibeam 65541, wait 65543, nwse 65549, nesw 65551, ew 65553, ns 65555,
  hand 65567.
- **Every subpath in `shapes.ts` must be closed.** All eight shapes render
  through one recipe — stroke black, then fill white — and Canvas2D's `fill()`
  encloses zero area on an open subpath, so a bare polyline paints nothing and
  only the stroke survives. Five of eight shapes were open for an entire phase:
  `ibeam` rendered as a solid black glyph and the four resize cursors as white
  heads joined by a black bar. `shapes.test.ts` now asserts closure.
- **`new Path2D(bad)` does not throw.** It silently yields an empty or truncated
  path, so a typo in path data is invisible to every runtime check. The grammar
  tests in `shapes.test.ts` exist for exactly this.
- **A feature the fixture never exercises is a feature nothing guards.** The
  five broken shapes survived nine reviews because `tests/fixtures/basic` had no
  `k:"cursor"` events at all, so parity and every screenshot had only ever drawn
  `arrow`. `make-fixture` now emits shape events. Same lesson as adding 1900 to
  the parity `SHOTS` so a ripple window was actually sampled.
- **The cursor must not scale with the zoom.** Position maps through the screen
  quad so the cursor tracks the camera, but size derives from output height
  alone. A cursor that grows as the camera pushes in reads as a bug.
- **Textures are re-rasterised per (shape, size), never scaled from one bitmap.**
  That is the entire reason the shapes are vectors.
- **The rasterised size and the on-screen geometry must come from one value.**
  `CursorTextureCache.get` returns `{ texture, px }` where `px` is the clamped,
  rounded size it actually drew, and `padFor(px)` is the margin it actually used.
  `Renderer.drawCursor` derives the quad and hotspot offset from both. Computing
  geometry from the raw request instead puts the hotspot off the click point at
  any non-default size.
- **Cursor and ripples are not clipped to the screen quad.** `drawScreen`
  applies a rounded-rect SDF; the cursor and rings are free quads in output
  space, so a cursor near the source edge spills over the rounded corner onto the
  background. Windows clips it in reality. Low frequency, easy to live with.

**React and redraw — one idiom, and keep it that way**

`PreviewPlayer.draw()` runs on `play()` / `seek()` / `toggle()`, and nothing
else watches `project`. Exactly one thing bridges that gap: a `useEffect` on the
whole `project` in `Editor.tsx` that re-seeks the player at the current
playhead. **Do not add a second.**

It watches the whole object rather than a field list on purpose. `cursorPath`
and `ctx` are `useMemo`s on `project`, so a synchronous seek inside a handler
redraws with the OLD memos; and a dependency list that enumerates fields is one
somebody forgets to extend — which is exactly how `addCut` came to patch
`live.current` and never redraw at all. Phase C collapsed all three idioms onto
the effect and that bug went with them. Redrawing once more than strictly
necessary costs a decode that is almost always a cache hit.

The playhead itself is NOT React state during playback. `onTick` positions the
marker with a direct style write and updates React ten times a second for the
numeric readout only — immediately whenever playback is stopped. If you need
the live playhead in a component, take the element ref, not a state value.

**Media and timing**

- **Never hold more than one `VideoFrame`.** Buffering a GOP exhausts Chromium's
  frame pool and `flush()` hangs forever with no error. `frameAt` returns a
  clone — close it.
- **mp4box yields samples in decode order, not presentation order.** With
  B-frames those differ. `VideoSource` keeps two views for exactly this reason;
  a binary search over the decode-ordered array lands correctly only by luck.
- **Compare media times in integer ticks, never float ms.** An exact frame
  boundary computes as `1200.0000000000002` and selects the previous frame.
- **ffmpeg `-ss` is not a reliable oracle.** Boundary and midpoint seeks
  disagree by three frames. `verify:decode` decodes the whole fixture in order
  instead, and never seeks.
- **Preview and export must keep calling the same `Renderer`.** If they diverge
  that is a design-level failure. `verify:parity` is the guard.

**Packaging**

- **Do not let electron-builder rebuild native modules.** `npmRebuild: false`
  is deliberate: `uiohook-napi` ships `prebuildify --napi` binaries, which are
  Node-API and therefore ABI-stable, and the one in `node_modules` is what the
  dev build has always run. With the rebuild on, packaging dies with
  `Could not find any Visual Studio installation to use`.
- **`asarUnpack: "**/*.node"` is required.** A native addon cannot be loaded
  from inside an asar archive. There are two of them now, and they ship
  differently: `uiohook-napi` keeps its binary under `prebuilds/`, while koffi
  resolves its own from a **separate scoped optional dependency**,
  `@koromix/koffi-win32-x64/win32_x64/koffi.node` — nothing inside `koffi/`
  itself. The glob covers both; verify with
  `ls release/win-unpacked/resources/app.asar.unpacked/node_modules` after a
  `dist`. This matters because `import koffi` is at module scope in
  `CursorShapeReader`, transitively imported from `src/main/index.ts`, so a
  resolution failure in a packaged build is a **startup crash**, not the
  graceful degradation `start()`'s try/catch gives.
- **The single-instance lock must skip the headless modes.** `verify:parity`,
  `verify:decode`, `ZOOMCAST_SHOOT`, `ZOOMCAST_UI_SHOT` and
  `ZOOMCAST_RECORD_TEST` each spawn their own Electron while a normal instance
  may already be running. Taking the lock unconditionally makes every one of
  them exit immediately, silently, with no output.
- **The icon is generated, not vendored.** `tools/make-icon.ts` writes a real
  multi-size `.ico` with nothing but `zlib`. Change the drawing there, not the
  binary.

**Electron**

- **ESM (`.mjs`) preload requires `sandbox: false`.** With the sandbox on the
  preload silently never runs and `window.zoomcast` is undefined.
- **Compute the preload path from build output, not source layout.**
  `src/main/capture/AudioRecorder.ts` sits a directory deeper than
  `src/main/index.ts`, but both bundle into flat `out/main/`. Using
  `../../preload` to match source depth broke silently in exactly one window.
  Always use `preloadPath()` from `src/main/windows.ts`.
- **A `file://` page cannot fetch a custom scheme at all** — Chromium rejects it
  before the handler runs, so CORS headers do not help. The app is served from
  `zc://app`; disk media is `zc://app/@fs/<path>`.
- **Electron silently denies `getUserMedia`/`getDisplayMedia` from a custom
  scheme.** No error, no prompt — the promise just rejects.
  `registerDisplayMediaHandler()` installs the permission handlers explicitly.
  Phase 8's webcam will need this too.
- **`window-all-closed` must NOT quit.** This is a tray app with a global
  hotkey; it must survive zero windows (mid-countdown the overlay is briefly
  the only one). Quitting is explicit, from the tray.
- **Native addons cannot be bundled.** `main` and `preload` both need
  `externalizeDepsPlugin()` or the app crashes at startup with no useful
  message.
- **Main-process stdout is invisible on Windows.** Use `logDiag()` from
  `src/main/log.ts`, never bare `console.error`. Several "silent crashes" during
  development were just unreadable errors.

**Shortcuts and UI**

- **Never hardcode the record shortcut in UI copy.** It is chosen at runtime
  from a candidate list (`RECORD_HOTKEY_CANDIDATES` in `src/main/recording.ts`)
  because the obvious keys are taken: `Ctrl+Shift+R` is browser hard-reload,
  `Ctrl+Shift+W` closes the window, `Win+Alt+R` is the Xbox Game Bar recorder,
  and even `Ctrl+Alt+R` was already claimed on this machine. It currently lands
  on **Ctrl+Alt+Z**. The UI reads the live value via `recordHotkey()` — a
  hardcoded string had already drifted once.
- **A global shortcut is stolen from every other app** while zoomcast runs.
  Weigh that before adding more.

**Other**

- **`src/shared/` must not import electron, touch the DOM, or hit the
  filesystem.** That purity is why 179 tests run in plain node.
- **`project.json` is normalised on load, never cast.** `normalizeProject` in
  `src/shared/project/migrate.ts` merges field-by-field over `defaultProject`,
  so a file written by an older build — or half-written, or hand-edited —
  degrades to defaults rather than throwing. `bundleIo` used to do a bare
  `as Project`, which was safe only while the shape never changed; phase A added
  the first required field to it and phases B and C add more. **Anyone adding a
  field to `Project` must add it to `normalizeProject` too, or old projects
  silently lose it.**
- **A `useMemo` cannot be refreshed by patching a ref.** If a value feeds a
  memo, the redraw that must see it has to happen after the re-render, i.e. in
  an effect. See "React and redraw" above; phase C widened that effect to the
  whole `project` and deleted the other two idioms.
- **The inspector panel is long.** Thirteen zoom fields, a curve picker, five
  cursor controls and three style sections; `output` sits well below the fold. It scrolls, but
  collapsible sections would be a real improvement whenever someone is in there
  anyway.
- **`ripplesAt` scans every prior click each frame.** O(clicks before t), so a
  10-minute take with ~1500 clicks costs ~27M trivial iterations over a 60fps
  export. Fine in practice; a binary search for the window start would make it
  O(active ripples) if it ever shows up in a profile.
- **`verify:parity` runs the BUILT bundle.** Run `npm run build` before it, or
  it silently tests the previous code. This cost a confusing round in phase B,
  where a new aspect-ratio config reported PSNRs identical to the default
  because it was still rendering at the old size.
- **`verify:parity`'s preview PNGs are written to `dirname(out)`.** A config's
  mp4 therefore has to live inside that config's own directory, or previews
  from every configuration land in one place and the wrong pairs get compared.
- **`src/renderer/shoot.ts` is a THIRD `drawFrame` call site.** The rule
  elsewhere in this file says "preview and export are two separate call sites",
  and for product code that is true — but `shoot.ts` is a fourth wall. It
  deliberately draws no cursor and no ripples, so `ZOOMCAST_SHOOT` stills omit
  them. Do not assume a shoot fixture proves a cursor-related change.
- **Vite is pinned to ^7 and `@vitejs/plugin-react` to ^5.** `electron-vite@5`
  peers on vite ≤7 while plugin-react 6 needs vite 8.
- **PowerShell deletes an env var set to `''`.** Pass `' '` (a space) when a
  mode needs an intentionally blank value — this is why
  `ZOOMCAST_UI_SHOT=' '` renders the Welcome screen.
- **The `basic` fixture yields exactly one zoom**, in at ~155ms, out at ~4005ms,
  scale 1.176. Correct — `minHoldMs` 1500 cannot support more in a 5s clip. Use
  `npm run fixture -- spread` (30s, six separated clicks, gitignored) to judge
  pacing.
