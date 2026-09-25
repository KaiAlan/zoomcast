# Codebase review — 2026-09-26

A whole-project review of `phase-e-timeline-editing` (`c6a1e53`, `main` + 19).
Four parallel reviewers read main/capture, render/export, zoom/camera and
UI/infrastructure; the six most serious findings were then verified by hand
against the source. This note is the spec for
`docs/superpowers/plans/2026-09-26-review-round-1-fixes.md`.

## Health on this machine (Windows 11, AMD iGPU, ffmpeg 9.0.2 full)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | silent |
| `npm test` | 521 / 521 (51 files) |
| `npm run verify:decode` | 6 / 6 |
| `npm run verify:parity` | 30 / 30, 43.5–48.4 dB |
| `npm run verify:capture` | ddagrab, 57.35 fps (a 5 s run scored 47.9 and failed; use the default 8 s) |
| `npm audit` | 0 vulnerabilities |
| `npm outdated` | nothing more than a minor behind except vite 8 / plugin-react 6, held back deliberately |

## Verdict

The shape is right and does not need a rewrite: a pure `src/shared` core with
real tests, measured decisions, and a parity gate that proves preview equals
export. What can be made much better: a handful of real bugs (several
user-visible), the export data path, missing release infrastructure, and the
UI layer.

## Verified bugs (read in the source, not just reported)

| # | Sev | What | Where |
| --- | --- | --- | --- |
| V1 | High | **Preview playback with cuts runs away.** `clock.start` seeks the element to an *output* time; `onFrame` hands the element's *source* `mediaTime` to the player as output time; `renderAt` maps output→source again, so every frame re-adds the cut length and `frameAt` seeks forward each tick. Parity has no cut config and only seeks, so the gate cannot see it. | `Editor.tsx:287-306`, `PreviewPlayer.ts:122-138` |
| V2 | High | **Tray "Quit" does not quit.** It destroys windows; `window-all-closed` is deliberately a no-op; nothing calls `app.quit()`. Process, tray and hotkey survive. | `recording.ts:178-183`, `index.ts:571` |
| V3 | High | **Telemetry/audio anchor up to 500 ms late.** t=0 is `Date.now()` when the first `-progress` block is read; the default `-stats_period` is 0.5 s. Spec §11 promises ~20 ms. | `ScreenSource.ts:69-77, 300` |
| V4 | Med | **Export colour is BT.601, untagged.** rgba→yuv420p through swscale defaults; no `-colorspace` / `-color_primaries` / `-color_trc`. HD players assume BT.709. | `ffmpegArgs.ts:128-137` |
| V5 | Med | **Follow camera freezes 600 ms before every pull-out.** Sampling stops at `endMs − transitionOutMs` but the out-keyframe sits at `endMs + (transitionOutMs − trailMs)`, so the pull-out starts at `endMs − trailMs`. | `keyframes.ts:224` vs `:169-172` |
| V6 | Med | **Curve picker omits the default.** `CURVES` lacks `cameraZoom`; `config.easing` defaults to it, so the `<select>` shows the first option and any change is one-way. | `Inspector.tsx:69-73`, `config.ts:81` |

## Reported, plausible, not verified by hand

Main / capture: a take can vanish on stop if `ffprobe` throws (no manifest is
written, `listRecordings` hides the dir; `SessionController.ts:139`,
`ScreenSource.ts:223` also ignores `ZOOMCAST_FFMPEG`); ffmpeg dying mid-take is
silent (`ScreenSource.ts:271-277`); `zc://app/@fs/<path>` serves any file with
`ACAO: *` (`index.ts:94-138`); IPC arguments are unvalidated and `export:start`
forwards `outFile` / `encoder` into ffmpeg argv (`ipc.ts:91-94`); the GPU
registry pin is irreversible (`gpuPreference.ts:69`); probe results are cached
for the process lifetime; the hidden audio window leaks if `open` throws
(`AudioRecorder.ts:79-109`); `sandbox: false` only because the preload is
emitted as `.mjs`.

Render / export: every `frameAt` rebuilds a `VideoDecoder` and decodes from the
previous keyframe (~15× amplification; `VideoSource.ts:304-328`); `write`
awaits `drain` alone, so ffmpeg exiting with a full pipe hangs the export at N%
(`exportRunner.ts:58`); the whole mp4 is read into the renderer heap
(`VideoSource.ts:63`); `readPixels` allocates two full-frame buffers per frame
(`Renderer.ts:560-574`); `FrameState` is assembled twice and already differs
(`Editor.tsx` vs `exportClip.ts:115` applies `toStreamLocalMs`); single-span
audio is never trimmed; `MAX_BLUR_PX` is in output pixels while cursor and
ripples scale with height; rVFC never reports end-of-take so the player stays
`playing`; `planExportFrames` floors a float product.

Zoom: `lateralAuthority` is scale-only, so the y-axis "sideways step" returns
at non-native aspects (`viewport.ts:57`); typing anchors drift to the idle
mouse after `keyAnchorWindowMs` (`impulses.ts:41`); `normalizeProject` casts
`zoom.config` / `segments` / `keyframes` unchecked (`migrate.ts:98-112`);
`zoomAt` is a linear scan per frame; two implementations of "open at rest".

UI: `Editor.tsx` is a 747-line component owning project state, GL, player,
export and ~80 lines of harness hooks; every edit re-plans synchronously; `runExport`
opens the source outside its `try/finally`; `onBack` discards unsaved edits
silently; no `.tsx` is reached by any test.

Infra: no CI, no lint, no formatter; `npm test` fails (rather than skips) without
ffmpeg; unsigned installer; no auto-update; ffmpeg not bundled; `@shared` alias
declared in three configs and used nowhere; zod used in one file; four tools
duplicate the electron-spawn and PSNR code; README names `KaiAlan` as the
remote, the fork is `EpicAryan`.

## What would make it much better, beyond the fixes

1. A pure `frameStateAt(project, manifest, tSource)` in `src/shared` used by
   both `Editor.renderAt` and `exportClip` — closes the class of bug the
   project calls its most repeated.
2. A `deriveCamera(project, telemetry)` façade so four callers stop re-chaining
   `followPath → planZoom → replanSegments → segmentsToKeyframes`.
3. Encode in-process with WebCodecs `VideoEncoder` and pipe H.264 to ffmpeg
   for muxing: removes readback, IPC and swscale; makes 4K export tractable.
4. Hold shots while the cursor is still active, not only on impulses — the
   residue of "zooms out while I'm working".
5. A reducer + `usePreviewPlayer` hook extracted from `Editor.tsx` before the
   phase G restyle; jsdom + testing-library for one smoke test per component.
