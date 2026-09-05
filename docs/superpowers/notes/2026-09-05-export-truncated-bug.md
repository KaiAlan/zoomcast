# Open bug — export produces a truncated, unplayable mp4

Reported by the user 2026-09-05 after hand-testing the phase B build.
**Root cause NOT established.** This file records what was confirmed and what
was ruled out, so the next session does not start from zero.

## The symptom

`C:\Users\SATYAJIT\Downloads\2026-09-05T13-13-31.mp4` — 262,192 bytes,
unplayable.

```
$ ffprobe 2026-09-05T13-13-31.mp4
[mov,mp4,m4a,3gp,3g2,mj2] moov atom not found
Invalid data found when processing input
```

The header is `ftyp` → `free` → `mdat`, with **no `moov`**. ffmpeg writes the
`moov` trailer last, so this is a file whose muxer never finished. It is not
corrupt data — it is an incomplete write.

Mechanically that means `ExportSession.cancel()` ran instead of `finish()`
(`src/main/exportRunner.ts`): cancel ends stdin and `kill()`s ffmpeg, which
leaves exactly this. `cancel()` is reached from `exportClip`'s catch, so
**something threw inside the renderer's export loop**.

## The source take

`%LOCALAPPDATA%\zoomcast\recordings\2026-09-05T13-13-31\`

- 26,767ms, status clean, 1920x1080
- **captured fps 17.7** — gdigrab well under the requested rate
- audio offsets: mic −6587ms, system −938ms
- no `project.json`, so the user never saved; the export used in-memory state
- two background images had been copied in
  (`background-1788614189329.jpg`, `background-1788614212365.png`), which
  independently confirms the image picker works

## Confirmed by reproduction

A scratch copy of that exact take, with a `project.json` carrying the image
background the user had selected, exported **successfully**:

```
tmp/exportbug/out.mp4 — 38,799,457 bytes, h264 1920x1080 + aac, duration 26.766667
```

So none of these is the cause: the take itself, its 17.7fps capture, its
negative audio offsets, the image background, the LOD blur, or the frame count.

## Ruled out

- **`h264_amf` rejecting rawvideo over stdin.** Tested directly with the same
  pixel format and bitrate the export uses: exit 0, valid output. It works.
- **IPC volume.** 27s at 60fps is ~1620 frames of ~8MB RGBA, and the successful
  repro pushed exactly the same amount.
- **`exportRunner` logic.** `finish()` ends stdin and awaits a zero exit;
  `cancel()` is the only path that truncates, and it is only called from a
  catch.

## The one confirmed difference, and the strongest remaining lead

**The reproduction used a different encoder from the real UI export.**

| Path | Encoder | Line |
| --- | --- | --- |
| `verify:parity` / test hook | `libx264` | `Editor.tsx:209` |
| The real export button | **`h264_amf`** | `Editor.tsx:322` |

Both are hardcoded. **No test, guard or e2e case has ever exercised
`h264_amf`** — the e2e test and both parity paths use libx264. This is the same
"a guard only guards what it exercises" pattern that shipped five broken cursor
shapes in phase A.

And `h264_amf` is *very* slow here: measured at **~8fps for 1080p, 0.13x
realtime**. A 27s take at 60fps output is ~1620 frames, so encoding alone is
3+ minutes on top of per-frame render and IPC. That matters two ways:

- it is a long window in which anything transient can go wrong
- the target file appears in Downloads immediately and stays `moov`-less for the
  whole run, so **opening it mid-export shows exactly this symptom**

## Why the cause is not recoverable from here

`runExport` in `Editor.tsx:299-336` surfaces a failure only into React state:
`setExporting(null)` and `setStatus(err.message)`. That renders in the status
line and is gone on the next action. **Nothing reaches `logDiag`**, so
`%APPDATA%\zoomcast\main-error.log` has no entry for the export at all — only
hotkey registrations. A renderer-side export failure currently leaves no trace.

That is a defect in its own right, independent of this bug, and it is why this
investigation stops at two candidates instead of one cause.

## What to do next, in order

1. **Ask the user two questions** — they hold the only remaining evidence:
   - did the export button reach 100%, or stop partway?
   - did the status line show an error, and what did it say?
   - was the file opened before the export had finished?
2. **Make export failures diagnosable.** Route the catch in `runExport` through
   a new `window.zoomcast.logDiag(...)` (or reuse the existing IPC surface) so
   the reason lands in `main-error.log`. Without this, a retry that fails
   teaches nothing again.
3. **Guard `h264_amf`.** Either add an encoder parameter to the e2e export test
   and run both, or stop hardcoding two different encoders in one file. The
   asymmetry at `Editor.tsx:209` vs `:322` means the encoder used in anger is
   the only one never tested.
4. **Reconsider the default encoder.** At 0.13x realtime, `h264_amf` may be
   slower than `libx264` on this machine despite being hardware. Worth
   measuring both on the same take before treating it as the fast path.
5. Only then attempt a fix, with a failing case first.

## Do not

- Do not "fix" this by writing the mp4 with `+faststart` or by moving the moov.
  The file is incomplete, not misordered; a faststart flag would change nothing.
- Do not assume it is the image background. That was reproduced and works.
