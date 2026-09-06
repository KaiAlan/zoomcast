# zoomcast — handover

Updated 2026-09-06. **Phases 0–7, A and B complete; B is merged to main.**
Phase C has started — its export half is underway on `feat/phase-c-export`. The tool records your
screen, mic and system audio, plans zooms from real input telemetry, draws a
synthetic cursor with real shapes and click ripples, composes the frame over a
procedural or custom background, lets you cut and scrub, and exports a finished
MP4 at a chosen aspect and resolution.

Phase A replaced the old "phase 9 — cursor shapes" item. The remaining work is
tracked as phases C–F in
`docs/specs/2026-09-04-composition-and-camera-design.md` §13, plus webcam PiP
(the old phase 8), which is untouched and independent of all of them.

**Phase C is next, and it is the one the user actually wants.**

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
npm test              # 237 passing, 32 files
npm run typecheck     # silent
npm run build         # three bundles
npm run verify:decode # 6/6, k=0 wins each time
npm run verify:parity # 20/20 at 43-45dB, over four configurations (builds first)
npm run tune -- all   # zoom plan over every take on disk
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

## What is NOT built

Phases C–G are specified in `docs/specs/2026-09-04-composition-and-camera-design.md`
§13. None has a written plan yet.

**Start any new session at
`docs/superpowers/plans/2026-09-06-phase-c-export-diagnostics.md`.** Tasks 1–6
are done; task 7 (reproduce the head-of-file jump against a saved project) is
open, though the jump's root cause was found and fixed independently.
`docs/superpowers/plans/2026-09-05-phase-b-handoff.md` is now history — its
review happened, its fixes landed, and its three blocking questions were
answered.

**Phase C's camera half has no plan yet**, and it is the larger part: the
follow-cursor camera, retuned transitions, the preview loop rewrite, and the
two design problems the export investigation surfaced — a keyframe at `t = 0`
that cannot be eased into, and a zoom ceiling that exactly cancels the
composition.

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| C | Persisted zoom segments, follow-cursor camera, retuned transitions, preview performance | A, B — both now done |
| D | Directional motion blur | C |
| E | Draggable zoom segments, segment/global popover, real cut regions, undo/redo | C |
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

**C is the one the user actually wants.** The zoom complaint is measured, with a
specific signature, in `docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md`
— read that before touching a pacing dial. B goes first anyway, and the spec's
reason is good: the camera should be tuned once, against the finished composited
look rather than raw full-bleed footage.

**A seam phase C will hit, worth knowing before it starts.** Spec §8 claims the
cursor's position "comes from the same smoothed path the camera uses (§9), so
cursor and camera cannot disagree." That claim does not currently hold up:
`buildCursorPath`'s only damping input is `PathOptions.smoothing`, which is a
**presentation** control the user can set to 0 (raw telemetry), and
`MAX_HALF_LIFE_MS` is 90ms — a cursor-scale half-life. A follow camera wants
several hundred ms and must not go jittery because someone turned the cursor's
smoothing off. So C must either build a second path at camera damping (which
falsifies §8) or thread a separate half-life. The cheap future-proofing is to
let `PathOptions` take `halfLifeMs` directly and move the 0–1 `smoothing` →
half-life mapping to the Editor call site, where the style control actually
lives; `buildCursorPath` then serves both consumers without either owning the
other's units. **This is a spec issue as much as a code one** — fix §8's wording
either way.

**Webcam PiP** (the old phase 8) is independent of all of it: a third
`MediaRecorder` following the same hidden-renderer pattern as `AudioRecorder`, a
second `VideoSource` in the editor, the webcam pass in `Renderer`
(`FrameState.webcam` already exists), placement UI. It will need
`registerDisplayMediaHandler()` treatment for `getUserMedia`.

Also worth doing early:

- **Undo/redo.** Spec §6 specifies immutable project snapshots. Nothing yet.
- **Draggable cut regions.** Currently a placeholder "cut 0.5s here" button;
  there is no way to adjust or delete a cut once made.
- **`addCut` never redraws the paused preview.** Adding a cut changes the
  output→source mapping at the current playhead, but nothing redraws, so the
  frame on screen is stale until the user scrubs. Same family as the cursor bug
  fixed in phase A. See "three idioms" below.
- **Surface the `unclean` state.** A recording that ended abnormally is marked
  in the manifest and logged, but the Welcome list does not show it.
- **Delete recordings from the UI.** The list shows sizes; there is no delete.

## Known limitation: no working ddagrab on this machine

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
| `npm run verify:parity` | Preview and export render identically, across three configurations (default, styled, 1:1) — 15 comparisons |
| `ZOOMCAST_SHOOT` | Renders arbitrary frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` | Opens a bundle in the real editor and captures the window |
| `ZOOMCAST_RECORD_TEST=<seconds>` | Full record→stop cycle headlessly; result to `%APPDATA%\zoomcast\record-test.json` |
| `ZOOMCAST_RECORD_TEST_RUNS=<n>` | n recordings in **one process**, each reporting `hasCursorShapes` and its cursor-event count. Use 2+ for anything touching process-global state — see the koffi entry below |
| `npm run tune -- <take\|all>` | Replays real recordings through the planner: zoom count, pacing, holds, gaps, travel, and the cluster funnel |
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

- **On a 1080p source into a 1080p output every zoom is exactly 1.176x.**
  `maxComfortableZoom` is `source.w / (output.w * paddingFactor)` = 1/0.85, and
  any cluster tighter than ~1630px wants more than that, so it clamps. This
  means `marginPx` and `clusterRadiusPx` do nothing to zoom DEPTH at this
  resolution — only timing is tunable. Recording a higher-resolution source is
  the only way to get a deeper zoom.
- **`maxZoomsPerMinute` is a backstop, not a pacing dial.** Turning it down
  makes the result worse: it deletes the clusters that would otherwise have
  merged into one travelling shot, leaving isolated zooms and long flat
  stretches. Pace with `minHoldMs`, `minDwellMs` and `minRecoveryMs`.
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
- **At the zoom ceiling the composition is exactly invisible.** `1/0.85` is both
  the ceiling and the scale at which the screen fills the padded frame, so a
  zoomed-in take shows no background, no border and no shadow. That is a design
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

**React and redraw — three idioms, one question**

`Editor.tsx` answers "how does an edit reach the paused preview?" three
different ways, and `PreviewPlayer.draw()` runs only on `play()` / `seek()` /
`toggle()` with nothing watching `project`:

1. `onCursorChange` — a `useEffect` on `project.style.cursor`. **Correct**, and
   the only one that works for a value feeding a `useMemo`: `cursorPath` is
   memoised on `smoothing`, so a synchronous seek would redraw the OLD path.
2. `onConfigChange` — patches `live.current` inside the state updater, then
   seeks synchronously. Works, but depends on React invoking the functional
   updater synchronously at dispatch — the eager-state optimisation, which is an
   optimisation and not a contract.
3. `addCut` — patches `live.current` and never seeks at all, so adding a cut
   does not redraw. That is a live bug, listed above.

**Unify them in phase C**, which per spec §10 already owns preview performance
and rewrites the playhead/render loop wholesale. Do not add a fourth.

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
  an effect. See "three idioms" above. Phase B widened that effect to the whole
  of `project.style` and `project.output` rather than adding a fourth idiom.
- **The inspector panel is long.** Thirteen zoom fields, five cursor controls
  and three style sections; `output` sits well below the fold. It scrolls, but
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
