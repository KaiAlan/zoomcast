# Handoff — making the camera feel right

**Written 2026-09-07 at the end of the "make it like Recordly" session.**
**Branch:** `main`, clean, 6 commits ahead of where the day started
(`73fe059`..`b6cd2b3`).
**State:** 326 tests / 36 files, typecheck silent, `verify:decode` 6/6,
`verify:parity` 25/25.

## The ask, in the user's words

> "yeh the zoom is good we are zooming the window right, but this time lots of
> click didnt trigger the zoom and type text in inpout box didnt either"

> "gotta make the travel move and anoimation and all very smooth and natural
> like, what can we learn frm the recordly repo"

> "its currently lagging anf glitchy"

The reference is a Recordly export the user supplied at
`C:\Users\SATYAJIT\Downloads\export-1788795166944.mp4`, and Recordly is open
source — `github.com/daniel-p-green/recordly`. **Clone it and read it. Half of
what follows came from its source rather than from guessing at its output.**

## What landed today

In order, each with the measurement that justified it:

1. **`73fe059` per-segment follow switch.** Timeline draws shots as blocks,
   inspector switches one between `fixed` and `follow`. Rides across a re-plan
   by id without pinning.
2. **`852702a` retimed the zoom.** `screenStudio` =
   `cubic-bezier(0.16, 1, 0.3, 1)` over 1523ms in / 1015ms out, measured off
   the reference and confirmed in its source as `easeOutScreenStudio`.
   Asymmetric transitions (`transitionOutMs`) came with it.
3. **`327f42c` the window grows and travels again.** The 2026-09-07 morning
   rework had made the frame fixed and shrunk the sampled region — a crop,
   which is exactly what the user kept objecting to. Inverted back.
4. **`5a6fb8f` removed the hold cap.** See "Mistakes" below.
5. **`c2f3a9d` pan on its own curve and window**, and `minRecoveryMs`
   700 → 1500 so shots chain instead of retreating.
6. **`42c16bf` transitions may not start before the keyframe they leave.**
   Worst single-frame camera move on a real take: 495px → 85px.
7. **`b6cd2b3` `npm run bench:preview`.** The preview frame-rate harness the
   handover had been asking for since phase C.

## Start here

**The preview runs at ~13fps and that is what "lagging and glitchy" was.**
Measured, repeatable: `npm run bench:preview -- 2026-09-07T17-22-48` gives
13.6 / 13.0 / 13.0 across three back-to-back runs, p50 frame gap 40ms, worst
over 200ms, on a 60fps take. **Judging camera work in the editor is judging
the decoder.** Judge motion on an export until this is fixed.

Three routes, and the order matters:

1. **Decouple the playhead from the wall clock during playback.** This is the
   precondition for everything else — see the feedback loop below. Advance the
   playhead by frames actually drawn rather than by `performance.now()`.
2. **Preview at reduced resolution.** Decode cost scales with pixels and the
   preview canvas is far smaller than 1920x1080. Untried, cheap, and it does
   not need (1) first.
3. **Motion blur (phase D).** Does nothing for the preview but is the thing
   that makes an *exported* move look buttery. Recipe below, fully measured.

The user's own steer at the end was: they want smooth and natural travel. If
the editor's smoothness is not the priority, **skip to 3.**

## A stateful decoder was tried and reverted — read this before retrying

`VideoSource.frameAt` builds a **new `VideoDecoder` per frame** and decodes
from the nearest keyframe. GOP is exactly 30 (verified with
`ffprobe -show_entries frame=key_frame`), so that is ~15 frames of decode per
displayed frame.

Keeping a decoder alive between calls and feeding it only the chunks between
two positions took the preview from ~13fps to **1.5fps**, with `fastHits: 0` —
the fast path never once produced a frame, so every draw paid for the failed
attempt *and* the full-GOP fallback. Reverted in the same session.

Two things any retry has to deal with:

- **After `flush()` the decoder did not usefully accept further delta chunks
  here.** Not proven as a spec-level fact; proven as an observation on this
  machine and this build. Instrument before assuming otherwise.
- **There is a feedback loop, and it is the real obstacle.** `PreviewPlayer`
  sets the playhead from the wall clock (`outputAtStart + elapsed`). A slow
  draw therefore advances the playhead by about a second — ~60 frames at 60fps
  — which is past the next keyframe, so an incremental path **cannot engage
  during playback even when it works.** Keeping a decoder warm is not enough.
  Fix the loop first; that is why route (1) is first.

## Traps in the preview harness — both hit on the first attempt

- **A hidden `BrowserWindow` throttles `requestAnimationFrame` to about 1Hz.**
  The first run reported "1.0fps", which was the harness measuring itself.
  `runPreviewBench` shows the window and calls
  `setBackgroundThrottling(false)`, and warns when the tick count implies
  throttling. **Any future headless perf harness has the same hazard.**
- **Between machine states the number moves a lot.** 9.6fps and 20.7fps were
  both measured on the same code and the same take, while back-to-back runs
  sit within a few percent. `bench:preview` takes a run count and prints
  median and spread. **Compare a batch against a batch, never one run against
  one run.**
- It times **completed draws, not rAF ticks.** A tick arriving mid-render is
  dropped by `PreviewPlayer`, so counting ticks reports a healthy 60fps while
  the picture updates ten times a second. `droppedTicks` is the gap.

## Motion blur — the recipe, already measured

From `zoomTransform.ts` in the Recordly clone. Directly portable; this is
phase D:

- track camera `dx`, `dy`, `dScale` per frame, `dt` clamped to 1-80ms
- `speed = |velocity| + |dScale| * max(w,h) * 0.5` — **scale change counts as
  motion**, so a pure zoom blurs too
- `normalised = min(1, speed / 2000)` px/s
- `blur = normalised^2 * 8px * amount` — **quadratic**, so gentle moves get
  almost none
- below **15 px/s the blur is zero** — a deadzone, or an idle camera shimmers
- direction from the velocity vector, magnitude `* 1.2`
- kernel size steps 5 / 9 / 11 by blur amount

Ours renders in WebGL2, not pixi, so the filter itself has to be written —
but the *control law* above is the part that took measurement, and it is done.

## What else the reference has that we do not

- **A spring on the cursor**, not exponential decay: `stiffness/damping/mass`
  stepped per frame with rest thresholds, default smoothing 0.18. Ours is
  `buildCursorPath` at a half-life. **Careful:** a per-frame spring breaks
  `verify:parity`, because a 60fps preview and a 30fps export would diverge.
  It would have to be precomputed on a fixed grid, exactly as `followPath`
  already does.
- **`ZOOM_IN_OVERLAP_MS = 500`** — their zoom-in *finishes 500ms after* the
  region starts, so the camera is still arriving as activity begins. We arrive
  exactly at the start.
- **Click bounce and cursor sway.**

## What the reference does NOT do — do not chase these

- **No spring on the camera.** Springs are used only for the cursor; the
  camera is keyframed with bezier easing, like ours.
- **No cursor-following during a hold.** Measured on its own export: median
  0.0 and 1.2px/s across its two long holds. Its camera arrives and freezes,
  exactly like `position: "fixed"`. **The follow camera is not the route to
  this look**, and an earlier session in this same day wrongly said it was.

## Mistakes made today, so they are not repeated

- **`maxDwellMs` should never have existed.** It capped how long a zoom holds,
  from reading Recordly's `MAX_DWELL_DURATION_MS` as a zoom-length cap. In
  context that constant filters cursor-**dwell candidates** — "a run of
  stillness longer than 2.6s is not a dwell signal". The cap pulled the camera
  out at 6.62s on a real take **exactly as a 26-second typing run began**, and
  nothing re-engaged because the cluster was spent. It also left segments
  holding waypoints beyond their own end. Removed the same session.
- **The "28% of the take zoomed" figure is not a target.** It came from one
  45s clip of someone else's content and was over-fitted to. What transfers
  between tools is the curve and the transition windows; how much of a take is
  zoomed is a property of what the take contains.
- **The geometry rework earlier the same day inverted the model to fix what
  was actually a cap.** Third time this codebase has done that. When a change
  has no visible effect, look for the second cap before redesigning.
- **Two "before/after" comparisons were nearly reported from a computer-vision
  pipeline that silently diverges on our own composited output.** It measures
  the reference clip fine and the zoomcast renders not at all (peaks of 3567x).
  For our own output use `tune`, which is exact.

## Verification, all currently green

```powershell
npm test                      # 326 passing, 36 files
npm run typecheck             # silent
npm run build
npm run verify:decode         # 6/6, k=0
npm run verify:parity         # 25/25
npm run tune -- all           # pacing over every take
npm run bench:preview -- 2026-09-07T17-22-48   # ~13fps, three runs
```

`tune -- all` is byte-identical across every geometry and interpolation change
made today for every take that predates them — planning did not move, only
what the picture does.

## Loose ends

- **The fast decode path has no guard.** `verify:decode` and `verify:parity`
  run on `tests/fixtures/basic`, which has `has_b_frames=2`; real captures have
  0. So a B-frame-guarded fast path would be exercised by neither. If route (1)
  or a decoder retry happens, **add a no-B-frame fixture first** — the
  codebase's own lesson is that a feature the fixture never exercises is a
  feature nothing guards.
- `tmp/probe-funnel.ts`, `tmp/probe-overlap.ts`, `tmp/probe-jump.ts`,
  `tmp/render-pacing.ts` are throwaway probes from today; `tmp/` is gitignored.
  `probe-jump.ts` in particular carries a verbatim copy of the OLD `zoomAt`
  for before/after comparison and is worth keeping around while the
  interpolator is still moving.
