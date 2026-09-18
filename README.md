# zoomcast

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio equivalent, built for personal use.

Press a hotkey, record, and the editor opens with zooms already planned from
what you actually did: where you clicked, where you typed, where you paused.
Compose the result over a background, cut it, and export an MP4.

## What it does

- **Records** screen (GPU-side, via DXGI Desktop Duplication), microphone and
  system audio, plus a telemetry stream of every mouse and keyboard event.
- **Plans zooms automatically** from that telemetry — clustering activity into
  shots, then pacing them so they do not fight each other.
- **Drives a camera** that opens at rest and either holds a focus point or
  follows the cursor, per shot.
- **Draws a synthetic cursor** with real Windows cursor shapes and click
  ripples, so the pointer stays sharp at any zoom.
- **Composes the frame** over a procedural gradient, a solid colour or your own
  image, with rounded corners, shadow and an optional border.
- **Applies directional motion blur** driven by camera velocity (off by
  default).
- **Exports** an MP4 at a chosen aspect and resolution, with mixed audio,
  hardware-encoded where the GPU allows.

## Requirements

**Windows only.** This is not a portability gap that can be papered over:

- Capture uses **DXGI Desktop Duplication** through ffmpeg's `ddagrab` filter.
- Global input capture uses **`uiohook-napi`**.
- Cursor shape reading calls **`user32.dll`** directly through `koffi`.

It will not run under WSL, macOS or Linux. If you are working from WSL, drive
it through interop — see [Working from WSL](#working-from-wsl).

You need:

- **Node.js 20.19+** and npm (Vite 7's floor; developed on v24)
- **Windows 10/11** with a GPU that supports Desktop Duplication

- **ffmpeg 6.0+, a FULL build**, on PATH — gyan.dev's "full" or BtbN's.

**The "essentials" builds are not enough.** Screen capture runs
`ddagrab,scale_d3d11` and the essentials builds ship `ddagrab` but not
`scale_d3d11`, so they pass a naive check and then produce no frames. zoomcast
checks for both at startup and says so in the log if either is missing.

Point `ZOOMCAST_FFMPEG` at a specific binary to override PATH.

## Setup

```powershell
git clone https://github.com/KaiAlan/zoomcast.git
cd zoomcast
npm install
```

`npm install` is all the setup there is. `uiohook-napi` and `koffi` ship
prebuilt Node-API binaries, so there is no native build step and no Visual
Studio requirement.

## Running

### From source

```powershell
npm run build
npx electron .
```

Or with hot reload for the renderer:

```powershell
npm run dev
```

### Installed

```powershell
npm run dist
```

That writes `release\zoomcast Setup <version>.exe`. It installs per-user (no
admin), creates Start menu and desktop shortcuts, and ships an uninstaller.

## Using it

The app lives in the **system tray**. Closing the editor does not quit it —
**Show editor** brings it back, and quitting is explicit, from the tray menu.

| Action | How |
| --- | --- |
| Start / stop recording | **Ctrl+Alt+Z**, anywhere |
| Play / pause the preview | **Space** |
| Scrub | Drag the timeline |
| Back to the recordings list | **←** |
| Export | The **export…** button |

Recording gives you a 3-2-1 countdown, then a red border while it runs. Press
the hotkey again to stop; the editor opens the take with zooms already planned.

**Start with Windows** is a tray checkbox, off by default. With it on, Windows
launches zoomcast hidden at login so the hotkey is live with no editor window.

Recordings land in `%LOCALAPPDATA%\zoomcast\recordings\<id>\`.

### Tuning the zoom

Zoom pacing lives in `src/shared/zoom/config.ts`. Do not change a dial without
measuring it:

```powershell
npm run tune -- all
```

That replays every take on disk through the planner and prints what the plans
look like — zoom count, pacing, hold and gap times. Run it before and after any
change to those values.

## Verification

The project leans on measurement rather than assertion. Everything below runs
natively on Windows.

| Command | What it checks |
| --- | --- |
| `npm test` | Unit suite — 373 tests across 42 files |
| `npm run typecheck` | `tsc --noEmit`, must be silent |
| `npm run verify:decode` | That a frame rendered at time *t* really is the frame at *t* |
| `npm run verify:parity` | That the preview and the export compose identically, across 6 configurations × 5 times |
| `npm run bench:preview -- <take> [ms] [runs]` | What the preview actually achieves while playing |
| `npm run bench:encoders` | Encoder throughput, to justify the export's choice |

`verify:parity` is the important one. Preview and export decode through
different mechanisms — the preview draws from an `HTMLVideoElement`, the export
from a WebCodecs decoder — so this is what proves a change to one did not
silently diverge from the other.

**Compare benchmarks batch against batch, never one run against one.** Preview
frame rate moves a lot between machine states; back-to-back runs sit within a
few percent.

## Working from WSL

Reading, editing and `git` work fine against `/mnt/c/dev/zoomcast`. Running does
not. Drive it through interop:

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"
```

Avoid `find` and `du` across `/mnt/c` — it is slow.

**Electron's stdout does not reach the launching shell on Windows.** Diagnostics
go to `%APPDATA%\zoomcast\main-error.log` via `logDiag()`. Export failures log
the resolved settings and ffmpeg's stderr tail there.

## Project layout

```
src/
  main/       Electron main: capture, ffmpeg, IPC, tray, overlays
  preload/    The context bridge
  renderer/   Editor UI, WebGL2 compositor, export
    gl/       Shaders and the Renderer — one draw path for both preview and export
    media/    Frame sources: <video> for preview, WebCodecs for export
    ui/       React components
  shared/     Pure logic, unit-tested: zoom planning, camera, cursor, style
tools/        Verification and benchmark harnesses
docs/
  specs/      Design and decision log
  superpowers/plans/   Implementation plans
```

The rule that shapes most of it: **preview and export call the same
`Renderer`**, so what you see is what you get by construction. A visual feature
wired into only one of them is this project's most repeated bug — hence
`verify:parity`.

## Where to read next

- `docs/DEVELOPER-GUIDE.md` — the developer handoff: features, architecture,
  open work and what to do next. New developers start here.
- `HANDOVER.md` — current state, session checklist, and the mistakes that have
  already cost time. Start here.
- `docs/specs/2026-09-03-screen-recorder-design.md` — the original design and
  decision log.
- `docs/specs/2026-09-04-composition-and-camera-design.md` — composition,
  camera, and the phase roadmap.
- `docs/specs/2026-09-08-preview-frame-source-split-design.md` — why the
  preview and the export use different frame sources.

## Status

Recording → editing → export works end to end on real footage. Remaining work
is tracked as phases E–G in
`docs/specs/2026-09-04-composition-and-camera-design.md` §13: draggable zoom
segments and undo/redo, clip speed, and a UI revamp. Webcam picture-in-picture
is specified but not built.
