# zoomcast — handover

Written 2026-09-03, end of the first build session. Pick up here.

## What this is

A Windows screen recorder and editor with cursor-aware automatic zoom — a
Screen Studio equivalent, for personal use. Read these two, in order:

1. `docs/specs/2026-09-03-screen-recorder-design.md` — the design and the
   decision log (why AMF, why ripple cuts only, why the zoom ceiling is derived)
2. `docs/superpowers/plans/2026-09-03-zoomcast-phases-0-5.md` — 20 TDD tasks

## Start of session checklist

```powershell
cd C:\dev\zoomcast
npm test          # expect 116 passing
npm run typecheck # expect silent
npm run build     # expect three bundles
```

Everything runs **natively on Windows in PowerShell**. Not WSL — Electron,
`uiohook-napi` and DXGI are Windows-only. (The first session drove Windows
tooling through `powershell.exe` from WSL, which worked but is not the intended
setup. Run Claude Code natively on Windows.)

## Status

| Task | State |
| --- | --- |
| 1–14, 18, 19 | Done, tested, committed |
| 15 Renderer | Done, verified from rendered stills |
| 16 VideoSource | Done, verified against burned-in timecode |
| 17 Editor shell | **Not started** |
| 20 Export driver | Runner + e2e done; UI wiring not done |

116 tests pass. Typecheck clean. The export path works end to end against real
ffmpeg (`tests/e2e/export.e2e.test.ts`): 120 frames, ~4s, AAC, with a ripple cut
applied to both the video mapping and the audio graph.

## Do this first

**Fix `tools/verify-decode.ts`.** It currently reports 5 of 6 failures that are
not real — `VideoSource` is correct and the *verifier* is wrong.

Ground truth is not in dispute: `testsrc2` burns its timecode into the pixels,
and a render of `tMs=2500` shows `00:00:02.500`, frame 150. Correct.

The bug is in `extractFrame`. `ffmpeg -ss` at a frame *midpoint*
(`(n + 0.5) / 60`) returns a frame 3 later than intended, though `-ss` at the
exact boundary (`2.5`) returns the right one. Two earlier attempts also failed:
`select=eq(n\,IDX)` breaks on comma escaping through `execFileSync`, and
absolute PSNR against ffmpeg is useless because Chromium and ffmpeg disagree by
~25dB on `testsrc2`'s saturated primaries through YUV→RGB alone.

Recommended fix: stop seeking per frame. Extract the whole fixture once —
`ffmpeg -i screen.mp4 -vsync 0 tmp/ref/%04d.png` — and index the results. 300
frames, bulletproof, no seek semantics involved.

## Then: Task 17, the editor shell

The last unbuilt piece. Everything it needs exists:

- `bundleIo.ts` (main) reads a bundle through `parseManifest` / `parseTelemetry`,
  or creates `defaultProject(manifest.id)`. **Only main touches the filesystem —
  `src/shared/` must stay pure or the test suite stops working.**
- On load: `planZoom(telemetry, project.zoom.config, ctx)`, then `replan` against
  saved keyframes so pinned edits survive.
- Preview: `zoomAt(keyframes, outputToSource(playhead, durationMs, cuts))` into
  `Renderer.drawFrame` on rAF.
- Timeline must mark keyframes whose scale exceeds
  `maxComfortableZoom(source, output, paddingFactor)` — spec §8.

Then Task 20 steps 5–6: wire export to the UI with a `frameSource` that calls
`renderer.readPixels()` (already written, already flips rows for rawvideo).

## Things that will bite you

- **Never hold more than one `VideoFrame`.** Buffering a GOP exhausts Chromium's
  frame pool and `flush()` hangs forever, with no error. Cost me a 10-minute
  hang. `frameAt` returns a clone; close it.
- **`src/shared/` must not import electron, touch the DOM, or hit the
  filesystem.** That purity is why 116 tests run in plain node.
- **The `zc://` scheme is load-bearing.** A `file://` page cannot fetch a custom
  scheme — Chromium rejects it before the handler runs, so CORS headers do not
  help. The app is served from `zc://app`; disk media is `zc://app/@fs/<path>`.
- **Vite is pinned to ^7 and `@vitejs/plugin-react` to ^5.** `electron-vite@5`
  peers on vite ≤7 while plugin-react 6 needs vite 8. Do not bump blindly.
- **The `basic` fixture yields exactly one zoom**, in at ~155ms, out at ~4005ms,
  scale 1.176. That is correct — `minHoldMs` 1500 cannot support more in a 5s
  clip. Before tuning curves by eye, generate a longer fixture (~30s, clicks 4–6s
  apart in distinct regions); `tools/make-fixture.ts` takes the events as data.
- **Preview and export must call the same `Renderer`.** If they ever diverge,
  that is a design-level failure, not a detail.

## Useful commands

```powershell
npm run fixture        # regenerate tests/fixtures/basic
npm run verify:decode  # decode check (currently broken, see above)

# Render arbitrary frames to PNG through the real renderer:
$env:ZOOMCAST_SHOOT = (Get-Content -Raw tools\shots-spec.json)
$env:ZOOMCAST_SHOOT_DIR = 'C:\dev\zoomcast\tmp\shots'
npx electron .
```

That shot harness is how the compositor was verified without watching a window,
and it is how it caught a double Y flip that rendered every frame upside down.
Use it rather than trusting a change looks right.

## Deferred, deliberately

Phases 6–9 — screen capture (`ddagrab` + `uiohook`, tray, hotkey, overlay with
`setContentProtection`), audio, webcam PiP, cursor shapes via `koffi`. Sketched
at the end of the plan. Each gets its own plan document when its turn comes; they
will look different once the editor exists.
