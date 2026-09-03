# zoomcast — handover

Updated 2026-09-04. **Phases 0–5 are complete**: the tool opens a bundle, plans
zooms, cuts, previews and exports a finished MP4.

## What this is

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio equivalent, for personal use. Read these two, in order:

1. `docs/specs/2026-09-03-screen-recorder-design.md` — design and decision log
2. `docs/superpowers/plans/2026-09-03-zoomcast-phases-0-5.md` — the 20 tasks

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

All 20 tasks done. 116 unit/property tests, one export e2e, plus two
verification tools that check things unit tests cannot reach.

What works end to end today: open `tests/fixtures/basic` → the planner produces
keyframes from telemetry → scrub and play with live zoom → edit planner config
and watch keyframes re-plan while pinned edits survive → add a ripple cut →
export a 1920×1080 H.264 + AAC MP4 whose frames match the preview.

## What is NOT built

Phases 6–9, sketched at the end of the plan. **There is no capture yet** — the
only way to get a bundle is `npm run fixture`. That is the next body of work:

- **6 — screen capture.** `ddagrab=output_idx=0:draw_mouse=0:framerate=60`,
  encoder from `pickEncoder()`, `-g 30 -movflags +frag_keyframe+empty_moov`.
  `uiohook-napi` telemetry with a 250ms flush. Tray, global hotkey, 3-2-1
  countdown, border overlay using `setContentProtection(true)` so it stays out
  of the capture. Manifest assembly and the `status: "unclean"` path.
  Verify by recording, then opening the result in the editor that already works.
- **7 — audio.** `getUserMedia` mic, `desktopCapturer` with
  `chromeMediaSource: 'desktop'` for system loopback, `MediaRecorder` to disk.
  The risk is measuring MediaRecorder's true first-sample time rather than its
  start-call time. `syncNudgeMs` is already plumbed through to `-itsoffset`.
- **8 — webcam PiP.** Third recorder, second `VideoSource`, the webcam pass in
  `Renderer` (the `FrameState` field already exists), placement UI.
- **9 — polish.** Cursor shapes via `koffi` calling `user32!GetCursorInfo` at
  30Hz, click ripples, recordings library with sizes.

Also unbuilt and worth doing early in the editor: undo/redo (spec §6 specifies
immutable project snapshots), and dragging cut regions rather than the current
placeholder "cut 0.5s here" button.

## Verification tools

Three things are checkable without watching a window. Use them — each was
written after a bug that unit tests could not have caught.

| Command | Checks |
| --- | --- |
| `npm run verify:decode` | Every seek returns the frame that actually sits at that timestamp |
| `npm run verify:parity` | Preview and export render identically |
| `ZOOMCAST_SHOOT` | Renders arbitrary frame specs to PNG through the real compositor |
| `ZOOMCAST_UI_SHOT` | Opens a bundle in the real editor and captures the window |

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
- **A `file://` page cannot fetch a custom scheme at all** — Chromium rejects it
  before the handler runs, so CORS headers do not help. The app is served from
  `zc://app`; disk media is `zc://app/@fs/<path>`.
- **`src/shared/` must not import electron, touch the DOM, or hit the
  filesystem.** That purity is why 116 tests run in plain node.
- **Vite is pinned to ^7 and `@vitejs/plugin-react` to ^5.** `electron-vite@5`
  peers on vite ≤7 while plugin-react 6 needs vite 8.
- **ffmpeg `-ss` is not a reliable oracle.** Boundary and midpoint seeks
  disagree by three frames. `verify:decode` decodes the whole fixture in order
  instead, and never seeks.
- **The `basic` fixture yields exactly one zoom**, in at ~155ms, out at ~4005ms,
  scale 1.176. Correct — `minHoldMs` 1500 cannot support more in a 5s clip.
  Before tuning curves by eye, generate a longer fixture (~30s, clicks 4–6s
  apart in distinct regions); `tools/make-fixture.ts` takes the events as data.
- **Preview and export must keep calling the same `Renderer`.** If they ever
  diverge that is a design-level failure. `verify:parity` is the guard.
