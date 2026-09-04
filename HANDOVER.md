# zoomcast — handover

Updated 2026-09-04. **Phases 0–7 complete.** The tool records your screen, mic
and system audio, plans zooms from real input telemetry, lets you cut and
scrub, and exports a finished MP4. Phases 8 (webcam PiP) and 9 (cursor shapes,
polish) remain.

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
npm test              # 136 passing
npm run typecheck     # silent
npm run build         # three bundles
npm run verify:decode # 6/6, k=0 wins each time
npm run verify:parity # 4/4 at 43-45dB
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

- **8 — webcam PiP.** A third `MediaRecorder` following the same hidden-renderer
  pattern as `AudioRecorder`, a second `VideoSource` in the editor, the webcam
  pass in `Renderer` (`FrameState.webcam` already exists), placement UI.
- **9 — polish.** Cursor shapes via `koffi` calling `user32!GetCursorInfo` at
  30Hz, click ripples.

Also worth doing early:

- **Undo/redo.** Spec §6 specifies immutable project snapshots. Nothing yet.
- **Draggable cut regions.** Currently a placeholder "cut 0.5s here" button;
  there is no way to adjust or delete a cut once made.
- **Surface the `unclean` state.** A recording that ended abnormally is marked
  in the manifest and logged, but the Welcome list does not show it.
- **Delete recordings from the UI.** The list shows sizes; there is no delete.

## Known limitation: no working ddagrab on this machine

The spec was built around DXGI Desktop Duplication (`ddagrab`) for zero-copy GPU
capture. **It does not work here.** Neither the AMD adapter driving the panel nor
the NVIDIA adapter enumerates a DXGI output — `Failed to enumerate DXGI output 0`
— even though GDI capture of the same desktop works fine from the same process.
Looks like a hybrid-graphics/driver quirk, not permissions.

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
| `npm run verify:parity` | Preview and export render identically |
| `ZOOMCAST_SHOOT` | Renders arbitrary frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` | Opens a bundle in the real editor and captures the window |
| `ZOOMCAST_RECORD_TEST=<seconds>` | Full record→stop cycle headlessly; result to `%APPDATA%\zoomcast\record-test.json` |
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
  from inside an asar archive.
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
  filesystem.** That purity is why 116 tests run in plain node.
- **Vite is pinned to ^7 and `@vitejs/plugin-react` to ^5.** `electron-vite@5`
  peers on vite ≤7 while plugin-react 6 needs vite 8.
- **PowerShell deletes an env var set to `''`.** Pass `' '` (a space) when a
  mode needs an intentionally blank value — this is why
  `ZOOMCAST_UI_SHOT=' '` renders the Welcome screen.
- **The `basic` fixture yields exactly one zoom**, in at ~155ms, out at ~4005ms,
  scale 1.176. Correct — `minHoldMs` 1500 cannot support more in a 5s clip. Use
  `npm run fixture -- spread` (30s, six separated clicks, gitignored) to judge
  pacing.
