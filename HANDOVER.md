# zoomcast — handover

Updated 2026-09-04. **Phases 0–7 are complete**: the tool records your screen +
mic + system audio, plans zooms from real telemetry, cuts, previews and exports
a finished MP4. Phases 8 (webcam) and 9 (cursor shapes, polish) remain.

## What this is

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio equivalent, for personal use. Read these two, in order:

1. `docs/specs/2026-09-03-screen-recorder-design.md` — design and decision log
2. `docs/superpowers/plans/2026-09-03-zoomcast-phases-0-5.md` — the 20 tasks
   for 0–5 (6–9 were sketched there and built ad hoc after)

## Start of session checklist

```powershell
cd C:\dev\zoomcast
npm test              # 116 passing
npm run typecheck     # silent
npm run build         # three bundles
npm run verify:decode # 6/6, k=0 wins each time
npm run verify:parity # 4/4 at 43-45dB
```

Everything runs **natively on Windows in PowerShell**. Not WSL — Electron,
`uiohook-napi` and DXGI are Windows-only.

## Status

Recording, editing and export all work end to end on real footage today:

Press **Ctrl+Shift+R** (or the tray menu, or the Welcome screen's record
button) → 3-2-1 countdown → red border appears around the screen while it
records → mic + system audio capture in a hidden renderer → press the hotkey
again → bundle lands in `%LOCALAPPDATA%\zoomcast\recordings\<id>\` → the editor
opens it automatically → the planner has already derived zoom keyframes from
your actual clicks and typing → scrub, tune the planner config live, cut, export
a real MP4 with mixed audio.

**No fixture required for any of that anymore.** `npm run fixture` still exists
for the test suite and for reproducible manual testing.

## What is NOT built

- **8 — webcam PiP.** Third `MediaRecorder` (same hidden audio/media renderer
  pattern as phase 7's `AudioRecorder`), a second `VideoSource` in the editor,
  the webcam pass in `Renderer` (the `FrameState.webcam` field already exists),
  placement UI.
- **9 — polish.** Cursor shapes via `koffi` calling `user32!GetCursorInfo` at
  30Hz, click ripples, recordings library sizes shown in the Welcome list
  (currently shows id + total size only, no per-recording breakdown UI beyond
  that).

Also unbuilt and worth doing early: undo/redo (spec §6 specifies immutable
project snapshots), dragging cut regions rather than the "cut 0.5s here"
button, and a UI affordance for the `unclean` recording state (currently only
surfaced as a console/log message, not shown to the user in the Welcome list).

## The one thing that didn't go to plan: no working ddagrab on this machine

The spec was built around DXGI Desktop Duplication (`ddagrab`) for zero-copy
GPU capture. **It does not work here.** Neither the AMD adapter driving the
panel nor the NVIDIA adapter enumerates a DXGI output —
`Failed to enumerate DXGI output 0` — even though GDI capture of the same
desktop works fine from the same process. This looks like a hybrid-graphics /
driver quirk, not a permissions issue.

`ScreenSource.probeBackend()` tries `ddagrab` first and falls back to
`gdigrab` automatically, so this is transparent to everything downstream — the
manifest just records `"adapter": "gdigrab"` and the **measured**, not
requested, fps (gdigrab rarely sustains what it's asked for: it measured
~26–28fps against 30 requested in testing here). If you ever get `ddagrab`
working (try running ffmpeg from a terminal you opened directly, not through
WSL interop — that's the untested variable), the probe picks it up with no
code changes and you get 60fps GPU capture for free. See
`src/main/capture/ScreenSource.ts` for the probe and the manual repro command
in its comments.

## Verification tools

Things checkable without watching a window. Use them — each was written after
a bug that unit tests could not have caught.

| Command | Checks |
| --- | --- |
| `npm run verify:decode` | Every seek returns the frame that actually sits at that timestamp |
| `npm run verify:parity` | Preview and export render identically |
| `ZOOMCAST_SHOOT` | Renders arbitrary frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` | Opens a bundle in the real editor and captures the window |
| `ZOOMCAST_RECORD_TEST=<seconds>` | Runs a full record→stop cycle headlessly, writes the result (and any error) to `%APPDATA%\zoomcast\record-test.json` |

```powershell
# compositor stills
$env:ZOOMCAST_SHOOT = (Get-Content -Raw tools\shots-spec.json)
$env:ZOOMCAST_SHOOT_DIR = 'C:\dev\zoomcast\tmp\shots'
npx electron .

# editor screenshot at a chosen playhead
$env:ZOOMCAST_UI_SHOT = 'C:\dev\zoomcast\tests\fixtures\basic'
$env:ZOOMCAST_UI_SHOT_SEEK = '4600'
$env:ZOOMCAST_UI_SHOT_OUT = 'C:\dev\zoomcast\tmp\ui\editor.png'
npx electron .

# headless record test — proves capture end to end without clicking anything
$env:ZOOMCAST_RECORD_TEST = '5'
npx electron . | Out-Null
cat "$env:APPDATA\zoomcast\record-test.json"

# main-process diagnostics — console.error/logDiag output, since Electron's
# stdout on Windows does not reach the launching shell
cat "$env:APPDATA\zoomcast\main-error.log"
```

## Things that will bite you

Each of these cost real time; none is hypothetical.

- **Never hold more than one `VideoFrame`.** Buffering a GOP exhausts Chromium's
  frame pool and `flush()` hangs forever with no error. `frameAt` returns a
  clone — close it.
- **mp4box yields samples in decode order, not presentation order.** With
  B-frames those differ. `VideoSource` keeps two views for exactly this reason;
  a binary search over the decode-ordered array lands correctly only by luck.
- **Compare media times in integer ticks, never float ms.** An exact frame
  boundary computes as `1200.0000000000002` and selects the previous frame.
- **Electron only loads an ESM (`.mjs`) preload with `sandbox: false`.** With the
  sandbox on, the preload silently never runs and `window.zoomcast` is
  undefined.
- **The preload path must be computed relative to build output, not source
  layout.** `src/main/capture/AudioRecorder.ts` is one directory deeper than
  `src/main/index.ts`, but both bundle into flat `out/main/` and `out/preload/`
  directories. Computing `../../preload` per-file (matching source depth) broke
  silently in exactly one window. Always use `preloadPath()` from
  `src/main/windows.ts` — never compute it inline again.
- **A `file://` page cannot fetch a custom scheme at all** — Chromium rejects it
  before the handler runs, so CORS headers do not help. The app is served from
  `zc://app`; disk media is `zc://app/@fs/<path>`.
- **Electron denies `getUserMedia`/`getDisplayMedia` from a custom scheme by
  default, silently.** No error, no permission prompt — the promise just
  rejects. `registerDisplayMediaHandler()` in `AudioRecorder.ts` installs
  `setPermissionRequestHandler` and `setPermissionCheckHandler` explicitly for
  `media` and `display-capture`. Needed for phase 8's webcam too.
- **`window-all-closed` must NOT quit the app.** This is a tray app with a
  global hotkey; it has to keep running with zero windows (mid-countdown, the
  overlay is briefly the only window). Quitting is explicit, from the tray menu
  or `before-quit`.
- **`src/shared/` must not import electron, touch the DOM, or hit the
  filesystem.** That purity is why 116 tests run in plain node.
- **Vite is pinned to ^7 and `@vitejs/plugin-react` to ^5.** `electron-vite@5`
  peers on vite ≤7 while plugin-react 6 needs vite 8.
- **Native addons (`uiohook-napi`) cannot be bundled.** `main` and `preload`
  both need `externalizeDepsPlugin()` in `electron.vite.config.ts`, or the app
  crashes on startup with no useful message.
- **ffmpeg `-ss` is not a reliable oracle.** Boundary and midpoint seeks
  disagree by three frames. `verify:decode` decodes the whole fixture in order
  instead, and never seeks.
- **The `basic` fixture yields exactly one zoom**, in at ~155ms, out at ~4005ms,
  scale 1.176. Correct — `minHoldMs` 1500 cannot support more in a 5s clip. The
  `spread` fixture (30s, six well-separated clicks) exists for judging pacing —
  generate with `npm run fixture -- spread` (gitignored, not committed).
- **Preview and export must keep calling the same `Renderer`.** If they ever
  diverge that is a design-level failure. `verify:parity` is the guard.
