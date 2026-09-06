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

---

# Update 2026-09-06 — did not reproduce, and the premises above have moved

The user re-ran the export from the phase B build (`npm run build`, then
`npx electron .`, branch `feat/phase-b-compositor` at `8211ad0`), on the same
take, through the real export button — i.e. the `h264_amf` path.

**It succeeded.** Progress ran 0→100%, the status line said exported, and the
file plays:

```
C:\Users\SATYAJIT\Downloads\2026-09-05T13-13-31.mp4
37,842,342 bytes  h264 1920x1080 60fps CFR, 1606 frames + aac 48kHz
duration 26.766667 (video) / 26.532500 (audio), moov present
```

## What that does to the reasoning above

- **Step 1 is done.** The user's answers: the export reached 100%; there was no
  error text (the button shows the percentage, then says exported); and the
  original bad file was **opened after the export had finished**. That kills the
  "opened mid-export" candidate on the user's own evidence.
- **`h264_amf` has now been exercised in anger, successfully.** It is no longer
  "the untested path that truncates". It remains untested by any *automated*
  guard, so step 3 stands unchanged.
- **The ~8fps / 0.13x realtime measurement is wrong**, or was measuring
  something else. This export was 1606 frames in ~50 seconds — about **32fps,
  faster than realtime**. Step 4's premise ("hardware may be slower than
  libx264 here") should be re-measured rather than assumed; do not carry the
  8fps figure forward.
- The original truncation is therefore **unexplained and currently not
  reproducible**. Both remaining candidates survive only as possibilities.

**Step 2 is now the whole value of this file.** A one-off failure that cannot be
reproduced is exactly the case that instrumentation exists for, and the app
still records nothing about exports — not the failure, not the settings. If it
recurs without that, this investigation restarts from zero a third time.

## A second defect, found while checking this export

The exported file has a visible flaw at its head, unrelated to truncation. The
user described it as "at start its very laggy and slow and then suddenly fast",
and reported the editor preview looks correct.

Measured on the exported file:

- Frames 0–62 (0 → 1.033s) are essentially static: per-frame mean luma delta
  0.001–0.03 out of 255.
- **Frame 63 (t=1.05s) changes by 18.2** — roughly 4x larger than any step in
  the eased move that follows.
- Frames 63–88 are a normal eased camera move (delta rises to 4.5, then decays).

Opening the frames shows the head of the file renders **full-bleed** — the
styled background, rounded frame and shadow are entirely hidden because the
screen covers the whole output — and then the screen jumps and settles into the
composed look. A 420px top-left crop shows the screen moving ~240px right and
~107px up between frames 61 and 63. The top-left 160x160 region steps from
screen content (luma 50.8) to a flat background value (61.88) in one frame and
then holds perfectly constant for nine frames.

### What is ruled out for this second defect

| Suspect | How it was eliminated |
| --- | --- |
| VFR capture warping content time | `VideoSource` locates frames by integer container ticks, not nominal fps |
| Output→source mapping drift | Source scene cuts at 2.367s and 12.067s land at exactly those times in the export |
| Wrong duration / global speed | Export duration matches the source exactly (26.766667s) |
| The easing snapping on its first frame | `zoomEase` = `cubicBezier(0.33, 0, 0.1, 1)` moves 0.3% in its first frame at 60fps; it front-loads its motion (15% by 100ms, 84% by 300ms) and then crawls, but it does not step |
| `zoomAt` producing the jump | Replayed offline against this take: scale goes 1.17647 → 1.17631 → 1.17525 across the boundary, centre unmoved — 0.01% in the first frame |

### What is established

The planner opens this take with **zoom #0 running `in 0.00s → out 1.64s`** at
scale 1.176. A keyframe at t=0 cannot be eased into, because its transition
would have to start at −600ms, so **the video opens already at max zoom**. And
at 1080p source into 1080p output, `maxComfortableZoom` is exactly
`1/0.85 = 1.176` — precisely the factor at which the screen fills the padded
frame. **Max zoom exactly cancels phase B's composition.** That interaction
between phase A's zoom ceiling and phase B's framing is not written down
anywhere and is a design question for phase C, not only a bug.

### What is NOT established

Under `DEFAULT_ZOOM_CONFIG` the plan is provably smooth across t=1.05, yet the
exported frame jumps ~240px. A 240px margin on a 1920-wide output implies a
padding factor of **0.75**, not the 0.85 default — so the export very likely ran
with style/zoom settings that differ from the defaults.

**Those settings are not recoverable.** The bundle still has no `project.json`;
whatever was set in the inspector before exporting was never persisted. This is
the same evidence gap as the truncation, in a second form: an export cannot be
reproduced because nothing records what it was made from.

## Revised order of work

1. ~~Ask the user~~ — done, above.
2. **Make export failures reach `logDiag`** — unchanged, and now the main point.
3. **Record what an export was made from**, so any export can be reproduced:
   the resolved settings at minimum, ideally by persisting `project.json`.
4. **Guard `h264_amf`** in an automated test — unchanged.
5. **Re-measure both encoders** on one take; discard the 8fps figure first.
6. Investigate the head-of-file geometry jump against a reproducible export.

---

# Resolved 2026-09-06 — the head-of-file jump was a clamp discontinuity

Found by the phase B whole-branch review, then verified numerically against the
real functions with this take's own centre (cx 0.07005, cy 0.86782).

`screenQuad` in `src/renderer/gl/layout.ts` clamped the two regimes separately:

```ts
if (w >= output.w) x = clamp(x, output.w - w, 0);
```

The range `[output.w - w, 0]` has **zero width** at exactly `w === output.w`, so
`x` is pinned to 0 there — while the unclamped `x` is hundreds of pixels away.
One float below the crossover the clamp releases and the camera teleports.

| scale | x | y |
| --- | --- | --- |
| 1.1764705882 (= the ceiling, clamped) | 0.00 | 0.00 |
| 1.17631 (one eased frame later) | 229.01 | −110.07 |

229px right and 110px up in a single frame, against the ~240px right / ~107px up
measured off the exported PNGs. Worst single-step move across a fine scale
sweep: **254px**.

**Why every take hits it.** The crossover sits at `1 / paddingFactor`, and
`maxComfortableZoom` is `source.w / (output.w * paddingFactor)` — the same value
whenever output matches source. The planner's ceiling lands exactly on the
discontinuity, so a zoom that reaches the ceiling parks at `x = 0` (full-bleed,
composition invisible) and teleports on its way out.

**Why phase B made it matter more.** `layout.ts` is byte-identical to the phase
A merge, so this is pre-existing. But before `outputSizeFor`, output was always
the source size, so the crossover coincided with the ceiling and was only ever
touched at the top of a zoom. With a different output size the ceiling moves
*above* the crossover, so the camera crosses it **mid-zoom** — the review
measured a hard cut at `s = 1.1764 → x = 50.62` versus `s = 1.1765 → x = 0.00`
on 9:16, an aspect no export has ever exercised.

## The fix

One continuous range covering both regimes:

```ts
x = clamp(x, Math.min(0, output.w - w), Math.max(0, output.w - w));
y = clamp(y, Math.min(0, output.h - h), Math.max(0, output.h - h));
```

Below the crossover it reads as "keep the quad inside the frame", above it as
"never let an edge reveal background", and both ranges shrink to `{0}`
continuously at the crossing.

Measured after: the frame-62→63 step falls from 229.01px to **0.26px**, and the
worst step over the whole sweep from 254.19px to **0.09px**.

Guarded by two continuity properties in `src/renderer/gl/layout.test.ts` — a
scale sweep with a bounded per-step delta over eight centres, and the specific
crossing. Both fail before the fix and pass after. They are properties rather
than pinned positions on purpose: pinned values pass against a curve that jumps
between the points that were pinned.

## A behaviour change worth judging by eye

Below the crossover the old code applied no clamp at all, so the quad could hang
off the frame — at `scale = 1.17631` its right edge sat 228px outside the
output, which is why exported frame 63 shows the screen cut off at the right.
It is now kept nested instead. That is a **framing change for zooms focused near
an edge**: the subject sits less off-centre while the quad is near the output
size. It looks correct against the composition's intent, but it has not been
judged on real footage.

## Still open

- The original truncation remains unreproduced and unexplained. Nothing here
  touches it.
- Zoom keyframes at `t = 0` still cannot be eased into, so a take still *opens*
  at whatever scale the planner chose. The jump is gone; the hard-cut-in at the
  first frame is not. That belongs to the phase C camera work.
