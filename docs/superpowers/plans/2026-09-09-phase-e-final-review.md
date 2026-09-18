> Verbatim archive of the phase E final whole-branch review (from `.superpowers/sdd/2026-09-09-phase-e-timeline-editing/final-findings.md`). Status of each item as of 2026-09-18 is in `docs/DEVELOPER-GUIDE.md`.

# Final whole-branch review — findings to fix

FIX_BASE 5adbff6. Verdict was "merge after fixes": 0 critical, 5 important.
Controller rulings are marked RULING and are binding where they resolve a
choice the review left open.

---

## Important 1 — `src/shared/project/history.ts:56-62`: a drag can consume ZERO history entries and lose its pre-drag state

`beginOrExtend` opens a gesture by routing the first entry through `push`, whose
deep-equal guard (`history.ts:24`) declines a no-op and returns `h` untouched —
but `gestureOpen` is then set to `true` regardless:

```ts
return { ...push(h, next), gestureOpen: true };
```

If the first `applyTransient` of a gesture produces no change, nothing reaches
`past`. Every subsequent pointermove takes the `gestureOpen` branch, which
replaces `present` wholesale, so the pre-drag project is overwritten and nothing
holds it. `commit` (`history.ts:70-78`) then compares `past[past.length - 1]` —
an unrelated earlier edit — against `present`, finds them different, and closes
the gesture having recorded nothing. The whole drag is unrecorded, and the next
Ctrl+Z jumps back past both the drag and the edit before it.

Reachable, not theoretical. `outputToSource` does not clamp negatives
(`timeline.ts:38-55`), so `segmentDragToSource(p, id, -500ms)` on a segment
already at `startMs: 0` yields `delta = -500`, `moveSegment` clamps to `0`, and
for a segment that is ALREADY PINNED (any segment the user has dragged once
before) every field comes back byte-identical, keyframes rederive
deterministically, `same()` says equal. Same for a cut at the lane's left edge
(cuts have no `pinned` flag, so this needs no prior edit at all) and for
`cutResizeToSource` already sitting on the `MIN_CUT_MS` floor. "Push it as far
as it goes, then bring it back" is an ordinary gesture.

Suggested fix, in the pure module and testable without a harness:

```ts
export function beginOrExtend(h: History, next: Entry): History {
  if (h.gestureOpen) return { ...h, present: next, future: [] };
  return { past: capped([...h.past, h.present]), present: next, future: [], gestureOpen: true };
}
```

`commit`'s unwind then becomes the single place a no-op gesture is decided,
which is what spec §5 actually describes.

REQUIRED TEST: extend with an unchanged entry, then a changed one, then commit —
expect exactly one entry holding the pre-gesture project. Also add the direct
reproduction: a drag that ends where it started must consume NO history entry,
and a drag that moves must consume exactly one.

While you are in this file, fold in deferred minor T3b: add the one-line comment
noting `same()` (`history.ts:22`) is `JSON.stringify` equality, sound for
`Project` as shaped today (no `Date`/`Map`/`Set`, `pinned` required not optional,
key order fixed by spreading `defaultProject`) but a property of the type rather
than something this module enforces.

---

## Important 2 — `src/shared/project/edits.ts:175-185`: segment move preserves SOURCE duration; spec §7 mandates OUTPUT duration

Spec §7: "Each edge maps back through `outputToSource` INDEPENDENTLY rather than
applying one delta to both edges... Dragging a segment across a cut changes its
source duration while its output duration stays fixed."

`segmentDragToSource` maps only the start edge and hands `moveSegment` a source
delta; `moveSegment` (`edits.ts:71-78`) then sets
`endMs = startMs + (s.endMs - s.startMs)`, holding SOURCE length fixed.

Observable: `sourceSpanToOutput` shortens a span that crosses a cut
(`timeline.ts:66-88`, asserted at `timeline.test.ts:126-131`). Drag a 3s shot
from source 2000-5000 to output start 7000 with a cut at source 8000-10000:
source span becomes 7000-10000, of which 2000ms is removed, so the drawn region
collapses from 3000ms wide to 1000ms — it shrinks to a third under the cursor as
it enters the cut and re-expands on the far side.

The spec's mandated "dedicated test" is `edits.test.ts:247`, titled
"...preserving its output duration". It drags source 2000-5000 to output 9000,
landing at source 11000-14000 — entirely clear of the cut both before and after,
the one configuration where source- and output-preservation give identical
answers. It asserts the spec's words while exercising the code's behaviour and
would pass under either implementation.

Note the asymmetry: `segmentResizeToSource`'s doc comment (`edits.ts:190-201`)
restates §7 correctly, and resize DOES map each edge independently. Only move
diverges, and its doc comment omits the subject entirely.

**RULING — implement the spec, do not amend it.** Map the end edge too
(`outputToSource(targetStartOutputMs + outputLength)`) and hold OUTPUT width.
The spec is the binding authority for this phase and §7 is unambiguous; the
divergence has no recorded rationale anywhere in the branch, which makes it an
oversight introduced by sequence rather than a decision. It is also the
behaviour a user would expect: a shot dragged across a cut should not visibly
shrink to a third of its width under the cursor and then re-expand.

Watch the invariants while you do it: source width can only GROW when crossing a
cut (source span >= output span always), so `minSegmentMs` cannot be violated by
this change — but confirm that rather than assuming it, and check the no-overlap
clamp still holds when the end edge moves independently.

REQUIRED TEST: rewrite `edits.test.ts:247` around a segment that actually
STRADDLES the cut, asserting output duration is preserved and source duration
grows by the cut's length. The current test must not survive in a form that
passes under both implementations.

---

## Important 3 — `docs/superpowers/plans/2026-09-09-phase-e-handoff.md` merges to main with false, destructive instructions

The file's own heading is "tasks 1-6 landed, task 7 in flight". Line 21 tells the
reader the working tree has an untracked `useProjectHistory.ts` and modified
`Editor.tsx` and says "Prefer discarding", handing them
`git checkout -- src/renderer/ui/Editor.tsx` and
`rm src/renderer/ui/useProjectHistory.ts`. Following that today destroys tasks
7-12.

**RULING — banner it, do not delete it.** Add a prominent superseded banner at
the very top: that phase E is complete as of this branch, that the recovery
instructions below are historical and following them now destroys tasks 7-12,
and that HANDOVER.md is the current authority. Keeping the document preserves
the record of how the phase actually went, including the two usage-limit deaths;
deleting it throws that away to fix a problem a banner fixes. Cost if wrong: one
stale document with a correct warning on it.

---

## Important 4 — `HANDOVER.md:39` points at a file that will never exist on main

Both `HANDOVER.md:39` and `2026-09-09-phase-e-handoff.md:11` cite
`.superpowers/sdd/2026-09-09-phase-e-timeline-editing/progress.md` as the
authority carrying "every ruling made without the user in the room".
`.superpowers/sdd/.gitignore` ignores everything beneath it, so it is in no
commit, and the SDD workspace is deleted once this review is clean.

**RULING — copy the ledger into `docs/`, do not just drop the reference.** Copy
`.superpowers/sdd/2026-09-09-phase-e-timeline-editing/progress.md` to
`docs/superpowers/plans/2026-09-09-phase-e-ledger.md`, commit it, and repoint
both references at the committed copy. The ledger is the only record of ~15
rulings made without the user present, and the whole point of the earlier
task-12 ruling was that such a record must not die with the workspace. Dropping
the reference would satisfy the reviewer's literal finding while losing exactly
what the finding is about. Add a one-line header to the copy saying it is a
verbatim archive of the SDD ledger for this phase.

---

## Important 5 — the cut lane's layout formula is written out three times, and only the copy that cannot fail is under test

- `CutLane.tsx:267-268` — what is actually drawn (`others` filter, then
  `sourceSpanToOutput`, positioned against `outputDurationMs`).
- `edits.ts:362-386` `cutLaneGeometry` — what `cutDragToSource` /
  `cutResizeToSource` solve against.
- `edits.test.ts:441-450` `drawnFracs` — what every acceptance assertion in
  `describe("cutResizeToSource")` reads back.

Task 10's closed forms are correct ONLY while all three agree, and the third is a
hand copy of the first. Change `CutLane`'s layout and every test still passes
while the drag silently stops tracking the cursor.

Fix: one exported `cutLaneSpan(cuts, id, durationMs)` in `edits.ts`, consumed by
BOTH the lane and the test. This shrinks the untested `.tsx` surface at the same
time. `drawnFracs` in the test must call the shared function, not restate it.

While you are here, fold in deferred minor T10e: `ZoomLane.tsx:144-156` and
`CutLane.tsx:157-169` are an identical 12-line ResizeObserver + track-width
block. Extract `useTrackWidth()` beside `useRegionDrag`.

---

## Deferred minors the review triaged as FIX BEFORE MERGE

**M1 — `src/shared/zoom/derive.test.ts:36-46` "does not consult telemetry" is
vacuous.** It passes `telemetry: []` over a base ctx that already sets it, so
nothing varies. Populate telemetry and assert `replanFrom`'s segments change and
`deriveKeyframes`' do not. This is the seam every other task hangs off; a test
that cannot fail reads as coverage while providing none.

**M2 — `migrate.ts:56-70` still admits duplicate EXPLICIT cut ids**, while its
docstring promises "no two the same". `moveCut`/`resizeCut` find by id and map by
id, so both copies would move, and React sees duplicate keys. Two lines in a
function written to close exactly this class. Add a test.

**M3 — `dragKindAt` boundaries untested** (`geometry.ts`): the mirrored right
edge at `regionWidthPx - EDGE_HIT_PX`, and `regionWidthPx === MIN_RESIZABLE_PX`
exactly. Two assertions. This four-line function is the entire hit-testing
contract for both lanes and is why `geometry.ts` exists as a module.

**M4 — `CutLane.tsx:228-230`: the comment is false.** It claims the guard is what
stops a click spending an undo slot. `createCutFromDrag` returns `p` unchanged
below the floor and `push` deep-compares (`history.ts:24`), so it is a cheap
early-out, not a load-bearing guard. Fix the comment (or delete the guard and say
why). A reader chasing Important 1 who believes this comment looks in the wrong
layer.

**M5 — no `e.button` filter on any lane pointerdown** (`ZoomLane.tsx:65,168`;
`CutLane.tsx:59,249`). Four one-line guards. The consequence changed under the
repo's pattern: the same right-button press that used to scrub now authors a cut
or drags a shot.
