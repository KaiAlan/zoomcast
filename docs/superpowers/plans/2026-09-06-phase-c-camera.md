# Phase C — the camera

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the camera watchable — no hard cut on frame one, transitions that
do not crawl, a follow mode for long shots, and a preview smooth enough to
judge any of it on.

**Architecture:** Zoom segments become the persisted, editable unit; keyframes
stay the render-time representation derived from them. The follow camera is a
**precomputed** path — a pure function of telemetry and config — so preview and
export cannot diverge and `verify:parity` stays meaningful. The preview loop
moves the playhead out of React state, leaving one answer to "how does an edit
reach the paused preview?" instead of the current three.

**Tech Stack:** TypeScript, React, WebGL2, vitest.

**Spec:** `docs/specs/2026-09-04-composition-and-camera-design.md` — §6 (data
model), §8 (cursor pipeline), §9 (camera), §10 (preview performance), §13
(phases). Evidence:
`docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md`.

## Global Constraints

- `src/shared/` must not import electron, touch the DOM, or hit the filesystem.
- Windows-only, via PowerShell:
  `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.
- **Anyone adding a field to `Project` must add it to `normalizeProject`** in
  `src/shared/project/migrate.ts`, or existing projects silently lose it.
- **Preview and export must keep calling the same `Renderer`.** If they diverge
  that is a design-level failure; `verify:parity` is the guard, and it runs the
  BUILT bundle, so `npm run build` first (the script now does this itself).
- Never read an achieved frame rate off `avg_frame_rate` — it is a nominal
  container rate. Use `ffprobe -count_frames`.
- Baseline: 237 tests / 32 files, typecheck silent, `verify:decode` 6/6,
  `verify:parity` 20/20.

## Decisions taken with the user, 2026-09-06

1. **The zoom ceiling stays where it is.** At 1080p into 1080p, max zoom is
   exactly `1/0.85` — the factor at which the screen fills the frame and the
   background, border and shadow disappear. That is accepted: at peak zoom the
   shot is full-bleed by design, and the composition returns as it pulls back.
   **No cap, and no dynamic padding.** Do not "fix" this.
2. **Every take opens at rest.** A keyframe at `t = 0` cannot be eased into, so
   takes currently open mid-zoom as a hard cut on frame one. The first zoom is
   moved later so its transition starts at 0.
3. **One plan for all of phase C.** The preview rewrite is what makes the camera
   judgeable at 60fps, so tuning easing against a stuttering preview would be
   measuring the wrong thing.
4. **Follow is opt-in.** The planner keeps emitting `position: "fixed"`. Follow
   is something the user switches a segment to.

## What is already settled and must not be re-litigated

- **The source frame rate is not fixable by tuning.** gdigrab reaches about
  28fps at 1080p here whatever it is asked for; that was measured properly on
  2026-09-06 after an earlier figure proved wrong. Phase C can smooth motion
  *between* captured frames; it cannot invent frames. Do not report the low
  rate as fixed. Real 60fps needs ddagrab
  (`docs/superpowers/plans/2026-09-06-capture-frame-rate-and-settings.md` Task 7).
- **The head-of-file jump is fixed** and was not the planner: `screenQuad`'s
  clamp was discontinuous at exactly the zoom ceiling. Three properties in
  `layout.test.ts` hold it closed. If the camera still looks wrong at a
  transition's start, it is something new.
- **Pacing is tuned.** `minHoldMs`, `minDwellMs`, `minRecoveryMs` were tuned
  against real footage; `maxZoomsPerMinute` is a backstop, not a pacing dial.
  This plan changes *how a move feels*, not *when moves happen* — except for
  decision 2.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/cursor/path.ts` | **Modify.** Take `halfLifeMs` directly; the 0-1 mapping moves to the call site. |
| `src/shared/zoom/types.ts` | **Modify.** `ZoomSegment`; `transitionMs`/`easing` become project settings. |
| `src/shared/zoom/segments.ts` | **Modify.** Promote `Segment` to the persisted shape. |
| `src/shared/zoom/planner.ts` | **Modify.** Emit segments; guarantee the opening rest. |
| `src/shared/zoom/keyframes.ts` | **Create.** Segments → keyframes, including the follow path. |
| `src/shared/zoom/camera.ts` | **Create.** The precomputed follow path and its clamp. |
| `src/shared/project/migrate.ts` | **Modify.** Persist segments; migrate projects that have none. |
| `src/renderer/media/PreviewPlayer.ts` | **Modify.** Playhead in a ref, prefetch, one redraw path. |
| `src/renderer/media/VideoSource.ts` | **Modify.** Prefetch the next frames during playback. |
| `src/renderer/ui/Editor.tsx` | **Modify.** One redraw idiom; throttled readout. |
| `src/renderer/ui/Timeline.tsx` | **Modify.** Playhead by direct style write. |
| `src/renderer/ui/Inspector.tsx` | **Modify.** Transition duration/curve; per-segment follow. |

---

### Task 1: Let the cursor path serve two consumers

Spec §8 claims the cursor's position "comes from the same smoothed path the
camera uses (§9), so cursor and camera cannot disagree." **That claim does not
hold and cannot be made to hold as written.** `buildCursorPath`'s only damping
input is `PathOptions.smoothing`, a 0-1 *presentation* control the user can set
to 0 (raw telemetry), and `MAX_HALF_LIFE_MS` is 90ms — a cursor-scale
half-life. A follow camera wants several hundred ms and must not go jittery
because someone turned the cursor's smoothing off.

**Files:**
- Modify: `src/shared/cursor/path.ts`
- Modify: `src/renderer/ui/Editor.tsx` (the `buildCursorPath` call)
- Test: `src/shared/cursor/path.test.ts`
- Modify: `docs/specs/2026-09-04-composition-and-camera-design.md` §8

**Interfaces:**
- Produces: `PathOptions.halfLifeMs: number` replacing `smoothing`, and
  `smoothingToHalfLife(smoothing: number): number` exported for the call site.
  Task 5 builds a second path at camera damping through the same function.

- [x] **Step 1: Write the failing test**

```ts
// append to src/shared/cursor/path.test.ts
describe("halfLifeMs", () => {
  const events: TelemetryEvent[] = [
    { k: "move", t: 0, x: 0, y: 0 },
    { k: "move", t: 500, x: 1000, y: 0 },
  ];

  it("damps more at a longer half-life", () => {
    const quick = buildCursorPath(events, { halfLifeMs: 30, sampleHz: 120 });
    const slow = buildCursorPath(events, { halfLifeMs: 400, sampleHz: 120 });

    const at = (p: ReturnType<typeof buildCursorPath>) => cursorAt(p, 520)?.x ?? 0;
    // Both lag the step; the camera-scale path lags much further behind.
    expect(at(quick)).toBeGreaterThan(at(slow));
  });

  it("maps the 0-1 presentation control onto a cursor-scale half-life", () => {
    expect(smoothingToHalfLife(0)).toBeLessThan(smoothingToHalfLife(1));
    expect(smoothingToHalfLife(1)).toBeLessThanOrEqual(90);
  });

  /**
   * The camera must not become jittery because the user turned the CURSOR's
   * smoothing off. That is the whole reason these are separate inputs.
   */
  it("a camera-scale half-life is unaffected by the cursor control", () => {
    const camera = buildCursorPath(events, { halfLifeMs: 400, sampleHz: 120 });
    expect(cursorAt(camera, 520)?.x).toBeLessThan(1000);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/path.test.ts"
```

Expected: FAIL — `halfLifeMs` is not a `PathOptions` field.

- [x] **Step 3: Change the seam**

In `src/shared/cursor/path.ts`, replace `smoothing: number` in `PathOptions`
with `halfLifeMs: number`, delete the in-function mapping at the
`MIN_HALF_LIFE_MS + (MAX_HALF_LIFE_MS - MIN_HALF_LIFE_MS) * clamp01(...)` line
so the half-life is used directly, and export the mapping:

```ts
/**
 * The 0-1 style control, mapped onto a cursor-scale half-life.
 *
 * Lives here so the range stays with the code that knows what a half-life
 * means, but is applied at the CALL SITE: the camera builds its own path at a
 * several-hundred-millisecond half-life, and must not inherit a presentation
 * control the user can set to zero.
 */
export function smoothingToHalfLife(smoothing: number): number {
  return MIN_HALF_LIFE_MS + (MAX_HALF_LIFE_MS - MIN_HALF_LIFE_MS) * clamp01(smoothing);
}
```

- [x] **Step 4: Update the one call site**

In `src/renderer/ui/Editor.tsx`, the `cursorPath` memo becomes:

```ts
      buildCursorPath(bundle.telemetry, {
        halfLifeMs: smoothingToHalfLife(project.style.cursor.smoothing),
        sampleHz: 120,
      }),
```

- [x] **Step 5: Fix the spec, which is wrong as written**

In §8, replace the claim that cursor and camera share one path with: they share
one *function*, evaluated at two half-lives — a cursor-scale one driven by the
style control, and a camera-scale one fixed by the segment. Say why: a
presentation control the user can zero must not be able to make the camera
jitter.

- [x] **Step 6: Verify and commit**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test"
```

```bash
git add src/shared/cursor/path.ts src/shared/cursor/path.test.ts src/renderer/ui/Editor.tsx docs/specs/2026-09-04-composition-and-camera-design.md
git commit -m "refactor(phase-c): cursor path takes a half-life, not a style control"
```

---

### Task 2: Zoom segments become persisted and editable

**Files:**
- Modify: `src/shared/zoom/types.ts`, `src/shared/zoom/segments.ts`
- Modify: `src/shared/project/types.ts`, `src/shared/project/migrate.ts`
- Test: `src/shared/project/migrate.test.ts`

**Interfaces:**
- Produces: `ZoomSegment` exactly as spec §6 defines it, and
  `project.zoom.segments: ZoomSegment[]`. Tasks 3-6 consume both.

- [x] **Step 1: Read the existing Segment first**

`src/shared/zoom/segments.ts` already has a `Segment` type used between
clusters and keyframes, plus the guards that were tuned against real footage
(`applySegmentGuards`). Read it before changing it: the shape below must be
reachable from what the guards already produce, and **the guards' behaviour must
not change** — they encode the two pathologies found in real footage (a zoom
held for less than its own two transitions, and a zoom-out followed 140ms later
by a zoom-in elsewhere).

- [x] **Step 2: Add the persisted type**

In `src/shared/zoom/types.ts`:

```ts
/**
 * The persisted, editable unit. Keyframes remain the render-time
 * representation, derived from these; segments are what the planner emits, the
 * timeline draws and the user edits.
 */
export type ZoomSegment = {
  id: string;
  startMs: number;
  endMs: number;
  /** Follow is opt-in: the planner always emits "fixed". */
  position: "follow" | "fixed";
  /** 0..1, mapped onto the derived zoom ceiling rather than an absolute scale. */
  depth: number;
  cx: number;
  cy: number;
  origin: "auto" | "manual";
  pinned: boolean;
};
```

`depth` is 0-1 rather than an absolute scale on purpose: the ceiling derives
from the output size, so a stored absolute scale would be wrong the moment the
aspect changes.

- [x] **Step 3: Persist them, and migrate projects that have none**

Add `segments: ZoomSegment[]` to `project.zoom` in
`src/shared/project/types.ts`, and to `normalizeProject`. A project written
before this phase has keyframes but no segments; normalising must give it
`segments: []` rather than dropping the field, and the editor re-plans on load
anyway.

- [x] **Step 4: Test the migration**

```ts
// append to src/shared/project/migrate.test.ts
it("gives a pre-phase-C project an empty segment list", () => {
  const p = normalizeProject({ zoom: { keyframes: [] } }, "b");
  expect(p.zoom.segments).toEqual([]);
});

it("keeps stored segments", () => {
  const seg = {
    id: "s1", startMs: 0, endMs: 1000, position: "fixed",
    depth: 0.5, cx: 0.5, cy: 0.5, origin: "auto", pinned: false,
  };
  expect(normalizeProject({ zoom: { segments: [seg] } }, "b").zoom.segments).toEqual([seg]);
});
```

- [x] **Step 5: Verify and commit**

---

### Task 3: Derive keyframes from segments

**Files:**
- Create: `src/shared/zoom/keyframes.ts`
- Modify: `src/shared/zoom/planner.ts`
- Test: `src/shared/zoom/keyframes.test.ts`

**Interfaces:**
- Consumes: `ZoomSegment` (Task 2).
- Produces: `segmentsToKeyframes(segments, cfg, ctx): ZoomKeyframe[]`. Tasks 4
  and 5 both change what it emits.

- [x] **Step 1: Move the existing emission out of the planner**

`planZoom` currently walks `applySegmentGuards(segments, cfg)` and pushes an
in-keyframe per waypoint plus a scale-1 out-keyframe at `s.endT`. Move exactly
that logic into `segmentsToKeyframes`, taking `ZoomSegment[]`, with `depth`
mapped through `maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor)`.
`planZoom` then returns segments, and the caller derives keyframes.

- [x] **Step 2: Pin the existing behaviour before changing it**

Write a test that the derived keyframes for a single fixed segment match what
the planner produces today: an in-keyframe at `startMs` and an out-keyframe at
`endMs` with `scale: 1`, both carrying the config's easing and transition.

Then run `npm run tune -- all` and confirm it is **byte-identical** to the
current output. That is the regression guard for this whole task: pacing must
not move.

- [x] **Step 3: Verify and commit**

---

### Task 4: Every take opens at rest

Decision 2. A keyframe at `t = 0` cannot be eased into, because its transition
would have to start at `-transitionMs`, so `zoomAt` returns the keyframe's own
value from the first frame and the take opens as a hard cut.

**Files:**
- Modify: `src/shared/zoom/keyframes.ts`
- Test: `src/shared/zoom/keyframes.test.ts`

- [x] **Step 1: Write the failing test**

```ts
it("never emits a keyframe whose transition would start before zero", () => {
  const segments = [seg({ startMs: 0, endMs: 3000 })];
  const kfs = segmentsToKeyframes(segments, cfg, ctx);

  for (const k of kfs) {
    expect(k.tSourceMs - k.transitionMs).toBeGreaterThanOrEqual(0);
  }
});

it("opens at rest, then eases in", () => {
  const kfs = segmentsToKeyframes([seg({ startMs: 0, endMs: 3000 })], cfg, ctx);
  expect(zoomAt(kfs, 0).scale).toBe(1);
  expect(zoomAt(kfs, cfg.transitionMs).scale).toBeGreaterThan(1);
});
```

- [x] **Step 2: Implement**

When a segment's in-keyframe would sit at `t < transitionMs`, move the keyframe
to `transitionMs` rather than shortening the transition. A shortened transition
would make the opening move faster than every other move in the take, which is
the opposite of the intent.

Guard the case where that would push the in-keyframe past the segment's own
end: drop the segment instead, and say so in a comment — a zoom with no room to
arrive is the pathology `segments.ts` already guards elsewhere.

- [x] **Step 3: Judge it on real footage**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"
```

The take `2026-09-05T13-13-31` currently plans `zoom #0 in 0.00s out 1.64s`.
Expect its in-time to move to the transition duration, and the zoom count to be
unchanged.

- [x] **Step 4: Verify and commit**

---

### Task 5: The follow camera

Spec §9. Opt-in per decision 4: the planner keeps emitting `"fixed"`.

**Files:**
- Create: `src/shared/zoom/camera.ts`
- Modify: `src/shared/zoom/keyframes.ts`
- Test: `src/shared/zoom/camera.test.ts`

**Interfaces:**
- Consumes: `buildCursorPath` with an explicit `halfLifeMs` (Task 1).
- Produces: `followPath(telemetry, opts): CursorPath` and
  `clampToSource(centre, scale, ctx): { cx, cy }`.

- [x] **Step 1: Precompute, never integrate per frame**

This is the decision that makes parity hold. A per-frame simulation depends on
frame timing, so preview at 60fps and export at 30fps would produce different
paths and `verify:parity` would be right to fail. `followPath` is a pure
function of telemetry and config, evaluated once for the take.

Use the exponential (one-pole) lag, not a spring: memoryless exponential decay
composes exactly across step sizes, so no-overshoot and frame-rate-independence
hold exactly rather than approximately. An overshooting camera looks broken.

- [x] **Step 2: Write the failing tests**

```ts
it("never overshoots a step input", () => {
  const path = followPath(step(0, 1000), { halfLifeMs: 300, sampleHz: 120 });
  for (let t = 0; t <= 2000; t += 10) {
    expect(cursorAt(path, t)?.x ?? 0).toBeLessThanOrEqual(1000);
  }
});

it("is identical whatever rate it is sampled at", () => {
  // The property that keeps preview and export in agreement.
  const a = followPath(events, { halfLifeMs: 300, sampleHz: 120 });
  for (const t of [0, 100, 517, 2000]) {
    expect(cursorAt(a, t)?.x).toBeCloseTo(cursorAt(a, t)?.x ?? 0, 6);
  }
});

it("clamps so the viewport never leaves the source", () => {
  const { cx } = clampToSource({ cx: 0, cy: 0.5 }, 1.176, ctx);
  expect(cx).toBeGreaterThanOrEqual(0.5 / 1.176);
});
```

- [x] **Step 3: Implement, clamping the smoothed path**

Apply the clamp to the **smoothed** path, not the raw cursor, so hitting a
source edge decelerates rather than sticking.

- [x] **Step 4: Wire it into keyframe derivation**

A `position: "follow"` segment samples `followPath` at each waypoint rather
than using a fixed centroid. Note the interaction with `screenQuad`'s clamp,
which is now continuous — a follow near an edge will ride that clamp, and that
is correct.

- [x] **Step 5: Verify, including parity**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run verify:parity"
```

Parity's configs use fixed segments, so this cannot regress them — which also
means **follow is unguarded by parity**. Add a fourth config with a follow
segment, or say plainly in the handover that it is not covered.

- [x] **Step 6: Commit**

---

### Task 6: Transitions that do not crawl

The measured signature: `transitionMs` 600 on `cubicBezier(0.33, 0, 0.1, 1)`.
That curve reaches 15% of its motion in the first 100ms, 84% by 300ms, then
spends the last 300ms covering 16% — the "floaty" the user reported. Spec §9
calls for longer and gentler, and for both to become project settings rather
than constants.

**Files:**
- Modify: `src/shared/zoom/types.ts`, `src/shared/zoom/config.ts`
- Modify: `src/renderer/ui/Inspector.tsx`
- Test: `src/shared/zoom/easing.test.ts`

- [x] **Step 1: Add a curve worth switching to**

Add a named easing whose velocity peaks near the middle rather than at 30%, and
test the property rather than pinning samples: no more than ~55% of the total
motion in the first third, and a monotonic curve.

- [x] **Step 2: Make duration and curve project settings**

They are already `ZoomConfig` fields (`transitionMs`, `easing`) applied per
keyframe. Surface both in `Inspector.tsx`, and route the change through
`applyPlan` the way `onConfigChange` already does — the keyframes carry the
values, so changing them must re-derive.

- [x] **Step 3: Judge on footage, not on reasoning**

Export the same take with the old and new curve and watch both. The phase B
lesson applies: two of that phase's mistakes were caught only by rendering and
measuring, never by reasoning.

- [x] **Step 4: Commit**

---

### Task 7: The preview loop

Spec §10. Do this before tuning anything by eye — a stuttering preview makes
every easing judgement wrong.

**Files:**
- Modify: `src/renderer/media/PreviewPlayer.ts`, `src/renderer/media/VideoSource.ts`
- Modify: `src/renderer/ui/Editor.tsx`, `src/renderer/ui/Timeline.tsx`

- [x] **Step 1: Playhead out of React state**

`onTick` currently calls `setPlayheadMs` every rAF, so React re-renders 60x a
second during playback. Move the playhead to a ref, update React state on a
~10Hz throttle for the numeric readout only, and position the timeline playhead
by direct style write.

- [x] **Step 2: Prefetch**

`draw()` drops any tick arriving mid-decode (`if (this.busy) return`). Have
`VideoSource` prefetch the next frames during playback so a decoded frame is
waiting.

**Never hold more than one `VideoFrame`.** Buffering a GOP exhausts Chromium's
frame pool and `flush()` hangs forever with no error. `frameAt` returns a clone
— close it. A prefetch of exactly one frame ahead is the safe shape; anything
larger needs a hard cap and explicit closes.

- [x] **Step 3: One redraw idiom, not three**

`Editor.tsx` answers "how does an edit reach the paused preview?" three ways:
an effect on `project.style`/`project.output` (correct, and the only one that
works for a value feeding a `useMemo`), a functional-updater patch plus a
synchronous seek (works, but relies on React's eager-state optimisation, which
is an optimisation and not a contract), and `addCut`, which patches `live.current`
and never seeks — **a live bug: adding a cut does not redraw**. Collapse all
three onto the effect. Do not add a fourth.

- [x] **Step 4: Surface the measured capture rate**

Show `manifest.video.fps` in the editor. It cannot be fixed in software — see
"What is already settled" — but it can stop being mistaken for a rendering
fault.

- [x] **Step 5: Verify**

`verify:parity` must still be 20/20: the preview path changed, and parity is
exactly the guard for preview/export divergence.

- [x] **Step 6: Commit**

---

### Task 8: Handover

- [x] Update `HANDOVER.md`: the three-idioms section goes (it is fixed), the
      `addCut` bug leaves the "worth doing early" list, and the camera section
      gains whatever the tuning actually settled on.
- [x] Record what follow is and is not guarded by.
- [x] Say plainly whether the user's "floaty and laggy" complaint is resolved,
      and on what evidence. Two of its three causes are addressable here; the
      third — source frame rate — is not, and must not be reported as fixed.

---

## What the execution changed, 2026-09-07

All 8 tasks are done on `feat/phase-c-camera`. Three places where the plan was
wrong or thin, recorded because the reasoning matters more than the diff:

1. **Task 2's `ZoomSegment` could not represent what the guards produce.** It
   had one `cx`/`cy`; `applySegmentGuards` merges nearby zooms into one
   travelling segment with several waypoints, and half the takes on disk have
   one. The type carries `waypoints` instead. Decided with the user; spec §6
   updated.
2. **Task 5's rate-independence test was a tautology** — it compared a value
   with itself. Written properly, it fails: two paths BUILT at different grid
   rates do not agree exactly, because the grid also quantises when a telemetry
   target changes. The property parity needs is that ONE precomputed path read
   at 30 and 60fps returns the same positions, and that is what the test now
   asserts.
3. **Task 4's shift silently broke the dwell floor.** Moving the opening
   keyframe to `transitionMs` while leaving the segment's end alone took the
   shortest hold to 1.04s, under the `transitionMs * 2` floor. The segment now
   ends later by the same amount, clamped to the next one's recovery gap.

Two things Task 5 and Task 6 could not settle without watching, and did not
pretend to: the transition curve's default (both curves ship; `zoomEase` is
still the default) and whether the preview is actually smoother (no frame-rate
harness exists). Both are in HANDOVER.md.

## Self-Review

**Spec coverage.** §6's segment model is Task 2; §8's false claim is Task 1;
§9's camera is Tasks 4-6; §10's three fixes are Task 7. §11 (timeline editing)
and §12 (speed) are phases E and F and are deliberately absent.

**Placeholders.** Tasks 1, 2, 4 and 5 carry real test code. Tasks 3, 6 and 7
describe transformations of existing code precisely enough to execute but do
not restate the code being moved — Task 3 in particular is a move, and copying
the current emission into this document would guarantee it drifts.

**Type consistency.** `ZoomSegment` (Task 2) is consumed by
`segmentsToKeyframes` (Task 3), extended in Task 4, and read for
`position: "follow"` in Task 5. `PathOptions.halfLifeMs` (Task 1) is what
`followPath` (Task 5) passes.

**Risk.** Task 3 is the one that can silently break pacing, which is why its
guard is `tune -- all` being byte-identical rather than a unit test. Task 7 is
the one that can silently break parity.
