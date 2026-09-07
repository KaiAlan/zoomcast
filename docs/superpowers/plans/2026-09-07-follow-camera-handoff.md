# Handoff — the per-segment follow camera

**Written 2026-09-07 at the end of the camera geometry session.**
**Branch:** `feat/phase-c-camera`, unmerged.
**Status: BUILT 2026-09-07.** All three design items landed; the switch is
reachable from the editor and measurably moves the camera. What remains of
this document is the three open questions at the bottom, which need eyes on an
export rather than code, and the lever not taken.

## What was built, and how it differs from the design above

- **§3 landed as designed.** `replanSegments` carries `position` across a
  re-plan by id and does **not** pin the segment. Three tests; two of them
  were red first.
- **§1 and §2 landed**, with two additions the design did not anticipate:
  - `sourceSpanToOutput` in `src/shared/project/timeline.ts`. A segment block
    needs a source *range* mapped to output, and `sourceToOutput` returns
    `null` inside a cut — right for a point, useless for a range that merely
    crosses one. Each endpoint collapses onto the cut's seam instead. Four
    tests. Doing this arithmetic inline in the component would have put it
    where nothing can test it.
  - Shots draw as **regions behind the keyframe markers**, not as their own
    strip. The track is 78px and the two marker rows already occupy 10–34 and
    44–68, so a strip would either collide or be too thin to click.
- **Two defects the work exposed, both fixed.** The footer counted keyframes,
  so a single follow shot on the 5s fixture read "33 zooms" — it counts
  `segments.length` now. And the follow sampler's 100ms keyframes drew 43
  markers over one hold, burying the two that mark a real camera decision;
  markers whose easing is `linear` are skipped, which is exactly and only the
  follow samples.
- **New harness: `ZOOMCAST_UI_SHOT_JS`** runs JS in the page after it settles
  and before the capture. Without it the UI harness can only photograph the
  editor as it loads, which is the one state no interaction bug lives in. It
  is what proved this feature works: click the block → `sk2` selected → switch
  to follow → `sk2 · follow` survives the re-plan.

**Evidence at the time of writing:** 315 tests / 36 files, typecheck silent,
`verify:decode` 6/6, `verify:parity` 25/25 at 43.9–46.1dB, and `tune -- all`
**byte-identical** against the pre-change tree, which is the guard that pacing
did not move. `camera:travel -- 2026-09-07T12-01-38` reports fixed 0px/s
against follow 128px/s over 23.2s of hold.

## The ask, in the user's words

> "i dont like that the section is zooming and getting croped, i want the
> camera to zoom and travel"

## The number that settles what is wrong

`npm run camera:travel -- <take>` measures how far the camera moves **during
the hold** — after it has arrived, before it leaves. Transitions are not the
question; the hold is.

```
                    motion during the hold
fixed (today)       0 px/s      the camera arrives and freezes
follow              45-76 px/s  it keeps tracking the cursor
```

Zero. Today's camera eases into a crop, holds it perfectly still, and eases
out. That is a cropped section, not a camera move, and it is exactly what the
complaint describes.

## What already exists

**The follow camera is built and tested.** `position: "follow"` on a segment
makes `segmentsToKeyframes` sample a precomputed cursor path (300ms half-life,
`followPath` in `src/shared/zoom/camera.ts`) every 100ms with linear ramps
between samples. `verify:parity`'s fifth config pins a follow segment and is
green, so preview and export provably agree on it.

Two reasons it does nothing today:

1. **The planner never emits it.** Phase C decision 4: follow is opt-in.
2. **There is no UI to switch it on.** A segment becomes a follow segment only
   by being written into `project.json` by hand.

It was also **inert until 2026-09-07** for a third reason that is now gone:
nothing cropped at the native aspect, so the camera had no viewport to move.
The geometry rework fixed that — every scale above 1 crops now.

To see it before writing any code:

```powershell
npm run render:camera -- 2026-09-06T17-50-34   # a-fixed and b-follow, side by side
npm run camera:travel -- 2026-09-06T17-50-34   # the numbers above, per take
```

## The decision taken with the user

Three options were offered: follow on by default; follow plus travelling
between focus points; or **a per-segment switch with the default left at
fixed**. The user chose the third.

So: **the default stays `fixed`. Nothing changes until a shot is switched.**

## The design agreed

### 1. The timeline draws segments as blocks

`project.zoom.segments` is persisted already, so this is drawing what is there:
a bar spanning `startMs`→`endMs` under the existing keyframe markers. Click
selects one. `Timeline.tsx` already maps source time to output time with
`sourceToOutput` for the keyframe markers — reuse it, and remember a segment
crossing a cut needs the same treatment.

### 2. The inspector gains a "selected shot" section

The selected segment's camera: `fixed` / `follow`. An empty state when nothing
is selected. This is the whole control surface for now.

### 3. The override rides across a re-plan by id — it does NOT pin the segment

**This is the part worth getting right.** `replanSegments` currently keeps a
segment wholesale only when it is `pinned` or `origin: "manual"`. The obvious
implementation — mark a follow shot as pinned — would also stop that shot
re-planning when a pacing dial moves, which is not what "switch this shot to
follow" should mean.

Carry only the camera mode across instead, keyed by segment id:

```ts
// in replanSegments, alongside the existing keep/clashes logic
const overrides = new Map(
  existing.filter((s) => !keep.includes(s)).map((s) => [s.id, s.position]),
);

const fresh = generated
  .filter((s) => !clashes(s))
  .map((s) => {
    const position = overrides.get(s.id);
    return position === undefined ? s : { ...s, position };
  });
```

Segment ids come from the cluster anchor (`s${waypoint.id}`), so they are
stable across a re-plan. If pacing changes enough that a cluster disappears,
its override goes with it — it degrades to `fixed`, which is the safe
direction.

**Tests to write:** the override survives a re-plan; it does NOT pin the
segment (the segment still re-plans its times when config changes); a pinned
segment still survives wholesale as before.

### Files

| File | Change |
| --- | --- |
| `src/shared/zoom/replan.ts` | The id-keyed position override above |
| `src/shared/zoom/replan.test.ts` | The three tests above |
| `src/renderer/ui/Timeline.tsx` | Segment blocks, click-to-select |
| `src/renderer/ui/Inspector.tsx` | The selected-shot section |
| `src/renderer/ui/Editor.tsx` | Selection state, and the handler that rewrites one segment's `position` |

### Deliberately out of scope

Dragging segment edges, adding or deleting segments, per-segment depth. That is
phase E proper. This is the minimum that answers "does follow look right on a
real shot".

## Traps this codebase has already fallen into

- **Look for the second cap.** Twice now a depth change did nothing because
  something downstream clamped it: first `fitScale`'s own clamp at pixel
  parity, then absolute intent bases against `min(base, pullback)`, which made
  the `max zoom` dial inert. If a change has no visible effect, something is
  clamping it. Verify with `tune`, not by reading the code.
- **Do not pin to persist.** See §3 above. Pinning is a different concept and
  reusing it here would quietly disable re-planning for that shot.
- **A test that cannot fail is worse than no test.** Two written this session
  were tautologies (`expect(f(x)).toEqual(f(x))`, and a spread pair where no
  pullback binds). Prove a new guard fails before trusting it — the continuity
  sweep in `viewport.test.ts` only became real after a mutation showed the
  first version passing a genuine discontinuity.
- **Judge motion on an export, never on the preview.** The preview decode cost
  is unchanged: advancing one source frame still decodes from the nearest
  keyframe, ~15 frames at GOP 30.

## Open questions for the next session

1. **Does follow read well on a short shot?** 45-76px/s is gentle and the lag
   is 300ms. On a 4-second hold it may feel sluggish or drifty. The half-life
   is `CAMERA_HALF_LIFE_MS` in `src/shared/zoom/camera.ts`, one constant.
2. **Does follow want a different depth?** Deeper zoom gives the camera *more*
   room to travel, not less: the centre is confined to `1 - 1/scale` of the
   frame — 23% at 1.3x, 36% at 1.55x, 50% at 2.0x. A follow shot may want to
   sit deeper than a fixed one.
3. **Scroll-led zooms land at 1.05-1.15x** on some takes — barely a zoom, but
   still paying a full 600ms transition in and out. A minimum-meaningful-zoom
   floor may be worth adding. Unjudged.

## The lever NOT taken, still available

Two zooms less than `minRecoveryMs` (700ms) apart already merge into one
travelling segment that stays in and pans. Anything further apart pulls out to
full screen and comes back in. **Widening that window would make the camera
travel between focus points instead of retreating between them** — the other
half of "zoom and travel", and what the user's GPT breakdown meant by "move
directly between focus points instead of always returning to full-screen".

It was offered and not chosen this session, because it changes pacing that was
tuned against real footage and deserves its own before/after. `tune -- all`
with `--set minRecoveryMs=...` is the way to look at it.

## Where things stand

- `docs/specs/2026-09-07-camera-geometry-and-depth-design.md` — the geometry
  and depth spec, implemented in full.
- `docs/superpowers/plans/2026-09-07-camera-geometry-and-depth.md` — its plan,
  all 11 tasks done, with a note on what the plan got wrong.
- 308 tests / 36 files, typecheck silent, `verify:decode` 6/6,
  `verify:parity` 25/25.
- The branch is **unmerged**. Nothing has gone to `main` since phase B.
