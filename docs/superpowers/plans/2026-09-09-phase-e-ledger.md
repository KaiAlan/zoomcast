> Verbatim archive of the SDD ledger for phase E (from `.superpowers/sdd/2026-09-09-phase-e-timeline-editing/progress.md`, which is gitignored). Historical record of every ruling made during the phase.

# SDD ledger — plan: docs/superpowers/plans/2026-09-09-phase-e-timeline-editing.md

Spec: docs/specs/2026-09-09-phase-e-timeline-editing-design.md (read, reachable)
Branch: phase-e-timeline-editing (cut from main @ 0f9c5e8)
Baseline: `tune -- all` md5 0b48e73fd9719c2dce45316c6fd23348, 148 lines
(scratchpad/tune-baseline.txt) — Task 1 and Task 12 are gated on it.

Ruling: feature branch in place, not a git worktree — a worktree needs its own
npm install of 657M including native uiohook-napi and Electron 44 across
/mnt/c, which the project CLAUDE.md explicitly says to avoid. Cost if wrong:
less isolation from the user's own edits to the same tree.

## Pre-flight conflict scan

### Cross-task: shared files and interfaces

| Tasks | Producer → consumer | Finding |
| --- | --- | --- |
| 1 → 7 | `replanFrom/deriveKeyframes(config, project, ctx)`, `DeriveContext` | OK — signatures match at both ends |
| 1 → 7 | `Editor.tsx`: T1 adds `deriveCtx`, T7 replaces `useState` | OK — T7 depends on T1's `deriveCtx`, ordered correctly |
| 2 → 5 | `normalizeCuts(cuts, durationMs, preferId?)` | OK |
| 2 → 10 | `Cut.id` | OK |
| 3 → 7 | `createHistory/push/beginOrExtend/commit/undo/redo/canUndo/canRedo`, `Selection` | OK — all nine names verified against T3's implementation |
| 3 → 12 | `Selection` | OK |
| 4 → 7 | `setSegmentCamera` | OK |
| 4 → 9 | `moveSegment(p,id,delta,duration)`, `resizeSegment(p,id,edge,tMs,duration)` | OK |
| 4 → 11 | `setSegmentDepth`, `deleteSegment`, `resetSegment` | OK |
| 4 → 12 | `deleteSegment` | OK |
| 5 → 10 | `addCut(p,id,start,end,duration)`, `moveCut`, `resizeCut` | OK |
| 5 → 12 | `deleteCut` | OK |
| 6 → 9 | `dragKindAt`, `pxToMs`, `DragKind` | OK |
| 6 → 8 | `msToPct` | OK |
| 8 → 9 | `ZoomLane.tsx` created then modified | OK |
| 8 → 10 | `CutLane.tsx` created then modified | OK |
| 8 → 11 | popover anchors to the selected segment's region | **GAP — no mechanism specified. See R3.** |
| 7 → 12 | the `edit` object in a `[]`-dep effect | OK — T12 prescribes a ref and says why |
| 2, 7, 10 → `Editor.addCut` | patched, then rewritten, then replaced | OK — strictly sequential |

### Per-task self-consistency

| Task | Finding |
| --- | --- |
| 1 | OK — `defaultProject(bundleId)`, `DEFAULT_ZOOM_CONFIG`, `TelemetryEvent` from `../bundle/types` and `Size` from `./types` all verified to exist |
| 2 | OK — tests and implementation agree; Editor really does build a `Cut` literal |
| 3 | **DEFECT — cap test asserts the wrong value. See R1.** Also see R2. |
| 4 | OK — all 8 clamping assertions hand-traced against the implementation and agree |
| 5 | OK — the merge-precedence and min-length assertions hand-traced and agree |
| 6 | OK — the three boundary assertions hand-traced and agree |
| 7 | **DEFECT — `select` pushes a history entry. See R2.** |
| 8 | OK |
| 9 | OK — pointer capture retargets events to the capturing element, so listening on the region is correct; `region.parentElement` is the lane div per T8's structure |
| 10 | OK |
| 11 | See R3 |
| 12 | OK |

### Rulings from the scan

Ruling R1: Task 3's history-cap test asserts `past[0]` is `micGainDb 11`; the
correct value is **10**. Traced: 110 pushes leave `past` = `[e0..e109]` capped
by `slice(len-100)` to `[e10..e109]`. The implementation is right and the test
is wrong — an executor would "fix" working code to satisfy it. Task 3's
dispatch carries the correction. Cost if wrong: a test asserts the wrong
retention boundary and the cap silently keeps 99 or 101 entries.

Ruling R2: Task 7's `select` must **not** push a history entry — change it to
replace `present.selection` in place. As written, every click on a segment
becomes an undo step, so Ctrl+Z would walk back through selections instead of
edits. Spec §2.5 requires selection to *travel in* snapshots so undoing a
delete restores it; it does not ask for selection changes to be independently
undoable. The behaviour §2.5 wants still holds: the delete's own `apply`
captures the selection as it was. Task 3's `push` test stays valid — `push` is
the generic primitive and may treat any difference as a change. Cost if wrong:
undo feels inert because it eats selection steps, or a delete's selection is
not restored.

Ruling R3: Task 11's popover renders **inside `ZoomLane`'s container**,
positioned with `msToPct` over the segment's output span — the same maths the
lane already uses to place the region. The plan says "anchored to the selected
segment's region" without saying how, and the alternative (measuring the
region's client rect and portalling to the body) needs DOM measurement,
scroll/resize handling and a portal for no gain here. Cost if wrong: the
popover clips at the lane's edges on a segment near either end, and Task 11
gains a follow-up to flip it inward.

## Progress

Task 1: dispatched (sonnet), BASE 0f9c5e8. Refactor-only; gated on tune baseline md5 0b48e73f.

All 12 briefs staged. Model plan by brief density:
- Complete code in brief (1,3,4,5,6): transcription + testing -> cheap/standard.
- Prose-described UI (8,10,11,12 -- 48/47/73/68 lines): needs judgment, mid-tier floor.
- Task 7 rewrites every mutation path in Editor.tsx: standard, highest risk of the run.

Task 1: implementer DONE, commit 11fc0df. 423/423 tests (47 files), typecheck
silent, parity 30/30, tune -- all byte-identical to baseline.
Concern assessed: brief named 3 applyPlan call sites, file had 4. The fourth is
the on-load effect; converting it to replanFrom matches the plan's Task 1 table
("load -> replanFrom") and the byte-identical tune output evidences no
behaviour change. Accepted, not a finding.
Task 1: task review dispatched (sonnet) over 0f9c5e8..11fc0df.
Task 1: minor (deferred): derive.test.ts "does not consult telemetry" is
vacuous -- it passes telemetry: [] which the base ctx already sets, so nothing
varies. Plan defect (brief Step 1), not an implementer deviation. A real test
would show populated telemetry changes replanFrom's output but not
deriveKeyframes'. Final review to triage.
Task 1: complete (commits 0f9c5e8..11fc0df, review clean)

Task 2: dispatched (sonnet), BASE 11fc0df. Cut gains an id; expect type-change
fallout across every test that constructs a Cut literal.
Task 2: implementer DONE, commit 2ffca22. 426 tests / 47 files, typecheck
silent, parity 30/30. 11 files needed the type change -- one beyond the brief's
named list (tests/e2e/export.e2e.test.ts), found by grepping as instructed.
Task 2: task review dispatched (sonnet) over 11fc0df..2ffca22.

Ruling: Task 3's implementer runs in parallel with Task 2's REVIEW. The skill
bars parallel implementers; a reviewer alongside an implementer is not that.
Task 3 creates only history.ts + history.test.ts -- no file overlap with Task 2
or with any Task 2 fix round. Cost if wrong: a Cut-shape change from a Task 2
fix would need Task 3 re-checked, but history.ts is generic over Project and
never inspects Cut.

Task 3: dispatched (haiku -- brief carries complete code, transcription plus
testing), BASE 2ffca22. Dispatch carries ruling R1 (cap test expects 10, not 11)
with an explicit instruction not to "fix" history.ts to satisfy the wrong value.
Task 2: minor (deferred): migrate.ts's new malformed/zero-length drop path has
zero direct test coverage (was previously an unchecked pass-through).
Task 2: minor (deferred): no test for a 3+-way merge chain with preferId naming
the middle cut. Verified correct by hand-trace (last is a running accumulator;
its id is only overwritten on an explicit preferId match), but untested, so a
future refactor of the merge loop could break it silently.
Task 2: minor (deferred, CARRY TO TASK 10): migrate's `cut-${i}` fallback does
not check for collision against an explicit id already present in the same
array. Not user-reachable today -- needs a hand-edited project.json AND there is
no id-keyed cut lookup anywhere yet. Task 10 introduces exactly that lookup, so
its dispatch must carry this pointer.
Task 2: complete (commits 11fc0df..2ffca22, review clean)

Task 3: implementer DONE, commit e96c045. 11/11 history tests, 437/437 full
suite, typecheck silent. R1 correction applied: cap test passes at 10 and
history.ts was NOT altered to fit the wrong value. Implementer added non-null
assertions on three array accesses in the TEST file for
noUncheckedIndexedAccess -- flagged to the reviewer to confirm none leaked into
history.ts.
Note: plan prose said "12 tests"; the brief's own blocks define 11. Plan prose
was wrong, 11 is correct. Told the reviewer so it does not raise a false
"missing test" finding.
Task 3: task review dispatched (sonnet) over 2ffca22..e96c045.
Task 4: dispatched (sonnet), BASE e96c045. Pure segment edit ops. Dispatch
stresses that setSegmentCamera must NOT pin while every other op must -- the
likeliest error in the task.
Task 3: minor (deferred): task-3-report.md says "7 exported functions"; there
are 8. Report prose only, code correct.
Task 3: observation for final review: same()'s JSON.stringify equality is sound
for Project AS CURRENTLY SHAPED -- reviewer verified no optional fields, no
Date/Map/Set, imageFile is string|null not undefined, and all entries are built
by spreading defaultProject so key order is stable. It is a property of the
type, not enforced by the module. If any Project field ever becomes optional,
same() needs revisiting. Worth a comment in history.ts at some point.
Task 3: complete (commits 2ffca22..e96c045, review clean)

Task 4: implementer DONE, commit 5b2c3e6. 20/20 edits tests, 457 tests / 49
files, typecheck silent. No code changes needed from the brief.
Note: plan prose said "21 tests"; brief's blocks define 20. Counted by hand:
1+7+7+2+1+1+1 = 20. Plan prose wrong again (same as Task 3's "12"). Pattern:
the plan's test-count prose is unreliable; the brief's it() blocks are truth.
Task 4: task review dispatched (sonnet) over e96c045..5b2c3e6. Pointed at the
pinning asymmetry, and at moveSegment's hi<lo case (neighbours closer together
than the segment's own length), which would clamp to lo and create the overlap
invariant 2 forbids.

Ruling: Task 6 runs next to Task 4's review instead of Task 5. Task 5 APPENDS to
edits.ts/edits.test.ts -- the exact files a Task 4 fix round would touch -- so 4
and 5 must serialize. Task 6 creates only timeline/geometry.ts + test, which
nothing else touches, and depends on neither. Cost if wrong: none to
correctness; task order in git history is 4, 6, 5.

Task 6: dispatched (haiku -- brief carries complete code), BASE 5b2c3e6.

Task 6: implementer DONE, commit 8584740. 10/10 geometry tests, 467 tests / 50
files, typecheck silent.
Report inaccuracy caught and verified false alarm: report claimed the split was
"5 pxToMs, 2 msToPct, 3 dragKindAt". Controller grepped the committed file --
actual split is 3/2/5 and ALL 10 brief blocks are present, including both
dragKindAt boundary cases. Report prose wrong, code correct.
Note: plan prose said "11 tests"; actual 10. Third stale count in plan prose.
Task 6: task review dispatched (sonnet) over 5b2c3e6..8584740.
Task 6: minor (deferred): brief's tests never pin the mirrored right-edge
boundary (regionWidthPx - EDGE_HIT_PX) nor regionWidthPx == MIN_RESIZABLE_PX
exactly. Brief-level gap; reviewer verified both correct by arithmetic trace.
Task 6: complete (commits 5b2c3e6..8584740, review clean)

Task 4: review found a CRITICAL, and it is a PLAN defect, not an implementer
deviation. resizeSegment changes startMs/endMs and never touches waypoints, so
dragging an edge inward past a waypoint leaves that waypoint outside
[startMs, endMs].

Controller verified the downstream claim independently in keyframes.ts:78-133
rather than taking it on faith, and it is WORSE than reported. Trace of the
brief's own test case -- segment [5000,12000], waypoints 5500/6500, start edge
dragged to 10500:
  i=0: outer Math.max(w.tMs, ...) clamps to latestSettleMs -> 6500
  i=1: settleMs = w.tMs, unclamped        -> 6500
Both keyframes land at 6500 -- before the segment starts at 10500, AND at the
IDENTICAL timestamp. That is exactly "the camera told two things at once",
produced from inside one segment rather than across two.

Ruling: the finding wins over the plan text. Spec 2.2's binding principle is
that segments never emit keyframes competing for the same instants; the plan's
resizeSegment violates it from the inside. Fix = DROP waypoints falling outside
the new bounds, not clamp them. Clamping collapses several waypoints onto one
timestamp, which recreates the crushed-waypoint bug this codebase fixed on
2026-09-08 (minWaypointGapMs: 900, confirmed present in config.ts:69 -- "two
waypoints 260ms apart = 190px in one frame"). If dropping would empty the list,
keep the single nearest waypoint and clamp its tMs into bounds, since a segment
with no waypoints has no camera target at all.
Cost if wrong: a user dragging an edge past a waypoint loses that waypoint's
framing rather than having it slide -- recoverable via undo, and reset-to-auto
restores planner waypoints wholesale.
Task 4: fix round 1/5 dispatched -- resumed the original implementer (context
intact). Finding sent verbatim plus the keyframes.ts trace and the drop-not-
clamp ruling. FIX_BASE 5b2c3e6.
Task 4: fix round 1/5 implemented, commit 811e67a. 24/24 edits tests (4 new),
471 tests / 50 files, typecheck silent. moveSegment untouched as instructed.
Note: Task 6's commit 8584740 sits BETWEEN 5b2c3e6 and the fix, a side effect of
the interleaving ruling. Re-review scoped to 8584740..811e67a so it sees the fix
alone, not Task 6's already-reviewed diff. Interleaving means FIX_BASE is not
always the head the previous review saw -- check git log before packaging.
Task 4: scoped re-review dispatched (sonnet) over 8584740..811e67a.
Task 4: fix round 1/5 (1 addressed, 0 open; commits 8584740..811e67a). Verdict
ADDRESSED. clipWaypoints drops rather than clamps; all-outside keeps the nearest
by distanceOutside and clamps it; empty-on-entry returns [] via the guard's
second clause; single-element reduce short-circuits without throwing.
moveSegment untouched. No pre-existing assertion weakened.
Task 4: complete (commits e96c045..811e67a, review clean after 1 fix round)

Task 5: dispatched (sonnet), BASE 811e67a. Cut edit ops, APPENDS to edits.ts and
edits.test.ts. 11 new test blocks -> 35 total in the file (plan prose says "32",
which was wrong even before the fix round added 4).
Task 5: implementer DONE, commit d86337e. 35/35 edits tests, 482 tests / 50
files, typecheck silent, parity 30/30. Deviation accepted: optional chaining in
two resizeCut assertions for noUncheckedIndexedAccess -- expect(p.cuts[0]?.endMs)
.toBe(2100) still FAILS if the element is missing, so nothing was weakened.
Task 5: task review dispatched (sonnet) over 811e67a..d86337e.

Task 7: dispatched (OPUS -- highest-risk task of the run: rewrites every
mutation path in a 747-line file, needs judgment not transcription), BASE
d86337e. Dispatch carries ruling R2 as a MANDATORY DEVIATION with the wrong
code quoted and the correct code given, plus four do-not-break constraints:
the [project] seek effect stays untouched, playhead stays direct-DOM,
live.current is updated in exactly one place, and replan:true only on config /
output / camera changes.
Task 5: minor (deferred, CARRY TO TASK 10): addCut enforces no minimum length of
its own -- only normalizeCuts' zero/negative filter applies -- so a 1-99ms cut is
creatable despite MIN_CUT_MS's doc comment implying protection. Brief defect,
not implementer. Task 10's drag-to-create is the ONLY thing that enforces the
floor ("a drag shorter than MIN_CUT_MS creates nothing -- that is a click"), so
its dispatch must carry this pointer or sub-minimum cuts become reachable.
Task 5: minor (deferred): resizeCut's start edge cannot heal a pre-existing
sub-MIN_CUT_MS cut whose endMs is itself under 100ms. Only reachable in the
first 100ms of a take and only if such a cut exists.
Task 5: minor (deferred): no test for resizeCut's preferId-survives-merge path;
only moveCut has one. Code passes id identically in both.
Task 5: complete (commits 811e67a..d86337e, review clean)

--- session 2 (resumed after session limit) ---

Task 7: the previous session's handoff says "no report was written, so nothing
about that work has been verified" and advised discarding. That is STALE.
task-7-report.md exists, mtime 17:14, AFTER both source files (17:07 / 17:09) --
the implementer finished and reported; the handoff was simply written before the
report landed. Verified rather than trusted (reports are not evidence):
  - select does NOT push: setHistory((h) => ({...h, present: {...h.present,
    selection}})). Ruling R2 IS applied -- the handoff's flagged unknown.
  - step captures h.present.selection into the pushed entry, so undo restores
    the selection an edit was made with.
  - live.current patched in exactly one place (the hook's onProject callback).
  - the [project] seek effect is byte-identical, comment included.
  - replan:true on config / output / camera only; default elsewhere.
  - addCut/setSegmentCamera call signatures match edits.ts.
  - no setProject or setSelectedSegmentId survives outside comments.
Gates re-run independently by the controller, not taken from the report:
  typecheck silent; 482 tests / 50 files; build 3 bundles; verify:parity 30/30;
  tune -- all md5 0b48e73fd9719c2dce45316c6fd23348, 148 lines -- BYTE-IDENTICAL
  to the branch baseline, which is the guard that rewiring every caller changed
  no planner behaviour. (Output carries no ANSI or CRLF, so raw / lf / stripped
  all agree -- the baseline is reproducible from WSL or PowerShell either way.)
Deviation accepted: the hook gained `reset` beyond the briefed interface. The
brief lists five handlers and misses a sixth mutation path -- the load-time
setProject(prev => ...replanFrom...) in the mount effect, which also hand-patched
live.current. Routing it through apply would leave canUndo true the instant a
bundle opens, undoing to a project with no segments -- a state never on screen.
reset re-derives, notifies, and rebuilds via createHistory. Correct call.
Task 7: complete (commit d25e2ef, gates verified by controller).

Task 7: minor (deferred, CARRY TO TASK 12): every sub-step of a slider is its
own history entry. onCursorChange / onStyleChange / onConfigChange fire per
input event, so dragging the smoothing slider fills the 100-entry cap with
intermediates. applyTransient/commitGesture exist and are wired into the hook
but NOT into the Inspector -- the brief routes all three through apply. Task 12
owns keyboard undo/redo, so it is the first task where this is user-visible.
Task 7: minor (deferred): no unit test covers the hook. There is no React test
harness (@testing-library/react is not a dependency; the suite is pure-module
vitest). select-does-not-push is exactly the kind of thing that regresses
silently -- pin it first if a harness ever lands.
Task 7: minor (deferred): onProject is called from inside a setHistory updater,
a side effect in a reducer. Safe today -- rederive is pure, no ids generated
inside, and main.tsx does not use StrictMode. If StrictMode is ever switched on
the cost is a duplicate replanFrom per edit, not a wrong result.

Task 7: task review dispatched (sonnet) over d86337e..d25e2ef. It was never
dispatched in session 1 -- the session ended between the implementer's report
and the review -- so the task-review gate is still owed and is being paid now.
Dispatch carries: R2 as the mandated deviation to judge against (not the
brief's literal push), controller acceptance of `reset`, the already-run gate
evidence (so the reviewer reads code instead of re-running tests), and the
no-React-harness fact so it does not raise the missing hook test as new.

Task 8: PREFLIGHT RULING (brief defect). The brief's Files list names only
Timeline.tsx and the three new lane files, but its Interfaces line mandates
that Timeline "adds onSelect: (s: Selection) => void and selection: Selection,
replacing selectedSegmentId and onSelectSegment". Editor.tsx is Timeline's only
caller, so that prop change forces an Editor.tsx edit the Files list omits.
Ruling: Editor.tsx IS in scope for task 8, limited to the Timeline call site --
pass edit.selection and edit.select straight through, deleting the inline
id-to-Selection adapter task 7 added. The derived `selectedSegmentId` local
STAYS: the Inspector still needs it for the selectedSegment lookup, and that is
not Timeline's concern. Cost if wrong: task 8's diff touches a second file, so
a task 7 fix round and task 8 would collide there -- which is why task 7's
review runs alone, before task 8 is dispatched, rather than alongside it as
ruling 7 would otherwise allow.
Task 8: lane heights 24 + 56 + 20 = 100 replace the current single HEIGHT = 78.
The implementer must be told the playhead is ONE element spanning the stack and
that playheadRef must keep pointing at it, or the Editor's direct-DOM playhead
writes during playback break silently -- tests will not catch it.
Task 8: brief says the zoom lane renders keyframe markers "exactly as
Timeline.tsx does now", but "now" is a 78px track with marker rows at top:10 and
top:44, each 24px tall -- the lower row spans 44-68 and does NOT fit the brief's
56px ZoomLane. "Exactly as now" is therefore impossible as literally written.
Ruling: preserve the MEANING -- two rows, zoomed above and unzoomed below, same
colours, same tooltips, same linear-easing filter -- and re-fit the offsets to
56px. Carry this to the implementer so it does not either overflow the lane or
silently collapse the two rows into one. Cost if wrong: markers clip at the lane
edge, or the zoomed/unzoomed distinction is lost. Cosmetic, caught by eye.
Note: the segments-as-regions comment in Timeline.tsx justifies itself with "the
track is only 78px and the two marker rows already occupy 10-34 and 44-68". That
reasoning is about the OLD geometry; the regions stay, but the comment must be
rewritten to the lane's terms rather than copied across stale.
Task 7: task review verdict SPEC COMPLIANT / QUALITY APPROVED, 0 critical,
0 important, 3 minor -- all three already recorded above as deferred minors
(reducer side effect, per-input history entries, no hook test). Reviewer
independently confirmed: select does not push; step captures selection; every
mutating path (apply/applyTransient/reset/undo/redo) reaches live.current; the
replan split matches derive.ts at all seven call sites; reset's useCallback deps
[rederive] and rederive's [] are both stable, so resetProject really does keep
the mount effect from tearing down Renderer/PreviewPlayer per edit; zero
setProject( left in Editor.tsx. No fix round needed.
Task 7: complete (commits d86337e..d25e2ef, review clean)

Task 8: dispatched (sonnet), BASE d25e2ef. Prose brief, 3 new files + 2
modified. Dispatch carries the three preflight rulings above: Editor.tsx is in
scope for the Timeline call site only, the 56px marker re-fit, and the stale
regions comment. Plus four do-not-break constraints: playheadRef stays ONE
element spanning the stack, the footer readout is unchanged, the ruler's
setPointerCapture moves verbatim, and the segment stopPropagation is DELETED
(the ruler owns scrubbing now).

Task 9: PREFLIGHT RULING -- CRITICAL brief defect, found before dispatch.
The brief justifies its move code with: "The move delta is measured from
startClientX ... so every intermediate applyTransient re-applies the TOTAL delta
to the pre-drag project rather than accumulating per-frame deltas. Accumulating
would drift and, worse, would compound against clamping."
The intent is right. The mechanism does not deliver it. Traced through the code
that actually exists:
  - useProjectHistory.step computes fn(h.present.project) -- the CURRENT present.
  - history.beginOrExtend, when gestureOpen, returns {...h, present: next}: it
    REPLACES present. It does not preserve a gesture base anywhere.
  => the second pointermove hands fn a project whose segment has ALREADY moved
     by d1, and the brief's fn then moves it by the total d2 again.
  Final position after moves d1..dN = S0 + d1 + d2 + ... + dN, where each di is
  itself a total-from-start. That is not "no accumulation" -- it is accumulation
  of totals, strictly worse than the per-frame accumulation the brief warns
  against. A segment would fly off under the cursor on the first real drag.
Second, smaller landmine in the same block: `sourceToOutput(s.startMs, ...) ?? 0`
-- sourceToOutput returns number|null and is null when the time is inside a cut,
so `?? 0` would silently teleport a segment to output zero rather than fail.
Ruling: make BOTH drag callbacks report ABSOLUTE output times, not a delta, and
drop the sourceToOutput/?? 0 hop entirely. useRegionDrag captures the region's
own start at pointerdown (regionBox.left - trackBox.left, via pxToMs) and reports
onMove(id, targetStartOutputMs) = that start + the pointer delta. Editor's
handler becomes idempotent:
    const targetSource = outputToSource(targetStartOutputMs, durationMs, p.cuts);
    return moveSegment(p, id, targetSource - s.startMs, durationMs);
Re-applying this to an already-moved project is a no-op, so replacing present
mid-gesture is now harmless. It also kills the clamping-bank case the brief
worried about: when moveSegment clamps against a neighbour, the next move
computes its delta from the CLAMPED position toward the same absolute target,
so nothing is banked and the segment does not leap when dragged back.
This matches the shape the resize path ALREADY has -- resize reports an absolute
tOutputMs and is idempotent for the same reason. The two callbacks become one
shape rather than two.
Rejected alternative: teaching step to apply fn against the gesture base
(h.past[h.past.length-1].project when gestureOpen). It would work, but it
reaches back into task 7's already-reviewed history/hook code, and it breaks on
an edge case -- push() is a no-op when the entry is unchanged, so a first
pointermove of zero movement leaves gestureOpen true with past[last] pointing at
an unrelated earlier edit, which would then become the drag base.
Cost if wrong: the drag feels anchored to the region's rendered left edge rather
than to the grab point within it. Cosmetic, and correctable inside useRegionDrag
alone by storing the grab offset.

Task 9: also carry -- the brief says to put the drag's onPointerDown on each
segment region "alongside the existing select handler". JSX takes ONE
onPointerDown per element; task 8 already put a select handler there. They must
be MERGED into a single handler, not both written. And the brief's
e.stopPropagation() comment ("The ruler owns scrubbing; without this a drag
would seek as well") describes the pre-task-8 tree, where the ruler was the
region's ancestor. After task 8 the ruler is a SIBLING lane, so stopPropagation
no longer has anything to stop. Keep the call (it is harmless and guards against
future nesting) but the comment must be rewritten or deleted -- shipping a
comment whose stated reason is false is worse than shipping none.

Task 10: both carried pointers VERIFIED in code, not merely inherited from the
session-1 ledger:
  - edits.ts:223 MIN_CUT_MS = 100 is referenced ONLY at edits.ts:279 and :282,
    both inside resizeCut's clamps. addCut does not reference it. So the floor
    genuinely does not exist on creation, and task 10 step 1 ("a drag shorter
    than MIN_CUT_MS creates nothing -- that is a click") is the only thing that
    enforces it. If the implementer treats that line as UI polish rather than
    the invariant, sub-minimum cuts become reachable for the first time.
    Note the check is specified in OUTPUT time while cuts store SOURCE time.
    That is safe in this direction: outputToSource has slope >= 1, so a source
    span is never shorter than the output span it came from. Checking in output
    time cannot admit a sub-floor cut.
  - migrate.ts:106 `str(c.id, `cut-${i}`)` mints a fallback id without checking
    it against explicit ids already in the array, so a project carrying an
    explicit cut id of literally "cut-1" collides with the fallback for index 1.
    Unreachable today because nothing looks a cut up by id -- task 10's
    moveCut/resizeCut wiring is exactly that lookup, so this is the task that
    makes it reachable. A collision moves or resizes the WRONG cut.
Both go into task 10's dispatch as required reading, not as background.

Task 8: implementer DONE, commit ab92c87. typecheck clean, 482/482 tests, build
3 targets. 5 files: Timeline.tsx recomposed (-150 lines), Ruler/ZoomLane/CutLane
created, Editor.tsx Timeline call site only.
Task 8: task review dispatched (sonnet) over d25e2ef..ab92c87, with the three
preflight rulings as the judging standard and three implementer concerns put up
for explicit adjudication.
Task 8: controller's own read of concern (a), pending the reviewer's:
sourceSpanToOutput(c.startMs, c.endMs, durationMs, [c]) DOES always return null.
Traced: edge(startMs) hits `tSource >= c.startMs` -> returns c.startMs - 0;
edge(endMs) hits `tSource >= c.endMs` -> removed += full span, loop ends ->
returns c.endMs - span = c.startMs. startMs == endMs, and the guard is
`endMs <= startMs`. So the implementer's reasoning is correct and passing the
full list would render nothing at all.
The consequence it leaves is real and the brief never addresses it: a cut is
rippled OUT of output time, so its true output footprint is a zero-width seam.
Rendering it net-of-other-cuts gives it its full SOURCE width sitting at that
seam, so the region covers output time that is real surviving footage. Worked
an example: cuts A=[1000,1500] and B=[2000,2500] render as A=[1000,1500] and
B=[1500,2000] -- they tile without overlapping each other, but A's region covers
output 1000-1500, which is footage that survived, and the zoom lane directly
above shows that same range as live. The lanes share an x-axis, so they disagree.
Spec 6's diagram does draw cuts as width-bearing regions, and task 10 needs a
non-zero width to grab and resize, so zero-width seam markers would contradict
both. Leaning: defensible choice, real cost, record it -- but hold the ruling
until the reviewer reports independently.
Task 8: task review verdict SPEC COMPLIANT / QUALITY APPROVED. 0 critical,
1 important (the CutLane depiction, adjudicated below), 2 minor.
Reviewer independently confirmed both silent-failure risks: exactly one
playheadRef element spanning 24+56+20, ref not re-pointed; and segment-click-
does-not-scrub now holds STRUCTURALLY -- Ruler is a sibling subtree, so a
pointerdown in a region has no bubbling path to the scrub handler, which is why
deleting stopPropagation was safe. Also confirmed marker rows re-fit to 6-26 /
30-50 inside 56px (ruling 2 satisfied) and both stale comments rewritten
(ruling 3 satisfied).
Credit where due: the implementer caught a regression the brief did not
anticipate. The playhead div is now a SIBLING painting on top of the lanes
rather than a child, so a click on its 2px column would hit nothing; it added
pointerEvents: "none" with a comment. Neither the brief nor the controller
foresaw that.
Task 8: minor (deferred): the per-lane split-border trick (Ruler rounds top,
CutLane rounds bottom, ZoomLane sides only, with matching border-none resets)
is undocumented and looks like an inconsistent reset to the next reader.
Task 8: minor (noted, no action): the brief says the ruler carries "time labels
currently drawn inside the track". The old track drew tick LINES only, no text.
The implementer built to the actual old code and said so. Fourth stale claim in
plan prose, after the three wrong test counts.

Task 8: RULING on the Important finding -- CutLane regions overlap the content
after their seam. ACCEPTED AS-IS for task 8, carried into task 10 with a
required mitigation.
The finding is true and it generalizes: for every cut, both edges map through
the other cuts subtracting the same constant, so the box is always the cut's
pre-removal SOURCE width anchored at the seam -- which is exactly the output
interval where the next clip really plays. The cut lane therefore claims output
territory that survived, and disagrees with the zoom lane directly above it.
Why it stands anyway:
  - The code is correct and internally consistent; this is depiction, not maths.
  - Spec 6's diagram draws cuts as width-bearing regions, not seam ticks.
  - Task 10 requires resizeCut via useRegionDrag, and task 6's geometry makes a
    region move-only below MIN_RESIZABLE_PX = 24. A zero-width or thin seam
    marker cannot be resized at all, so the accurate depiction would delete a
    required capability.
  - Drawing the cut lane on its own SOURCE-time axis was considered and
    rejected: spec 6 puts one playhead across all three lanes, and a source-time
    lane would place that playhead at the wrong time on that lane.
Required mitigation, carried to task 10: the region's meaning is "the material
removed at this seam", NOT "this output range is cut". Task 10 must mark the
seam itself -- a ~2px accent on the region's left edge, where the true cut point
is -- so position is unambiguous even though width is not. Cheap, keeps the
grab target, stops the box from being read as a covered range.
Cost if wrong: users misread which footage is cut until they scrub. Recoverable
-- the fix is confined to CutLane's region styling and changes no coordinates.
The user may want to overrule the depiction outright; it is flagged to them.
Task 8: complete (commits d25e2ef..ab92c87, review clean, 1 important
adjudicated and carried)

Task 9: dispatched (sonnet), BASE ab92c87. Carries the CRITICAL absolute-target
ruling, the merged-handler and stale-comment notes, and the select-toggle
interaction trap below.
Task 9: additional preflight -- task 8 put a TOGGLING select on the segment
region's onPointerDown (selected ? null : s.id). Task 9 adds a drag to the same
element and JSX allows one onPointerDown, so the two must merge. If the toggle
stays on pointerdown, starting a drag on an ALREADY-SELECTED segment deselects
it at the instant the drag begins -- the segment is then dragged while showing
as unselected, and task 11's popover would vanish under the user's own hand.
Ruling: select on pointerdown, but only ever TO the segment, never off it;
deselection moves to a click on empty lane space (which task 10 already
specifies for the cut lane). Cost if wrong: a segment cannot be deselected by
clicking it again -- minor, and task 10 supplies the empty-space path anyway.

Task 12: PREFLIGHT RULING -- the shortcuts would fire while the user is typing.
Editor.tsx:451-469's existing keydown effect guards against typing, but the
guard sits AFTER the Space test:
    if (event.code !== "Space" || event.repeat) return;   // <- filters first
    const typing = INPUT / TEXTAREA / isContentEditable;  // <- then guards
so the guard protects Space and nothing else. Task 12's brief hands the
implementer three new branches (Ctrl+Z, Delete/Backspace, Escape) without saying
where they go. Put them above the Space test -- the natural reading, since Space
returns early -- and they bypass the typing guard entirely: Delete or Backspace
while the cursor is in one of the Inspector's ~20 number/text inputs DELETES THE
SELECTED SEGMENT instead of a character, and Ctrl+Z undoes a project edit
instead of the text being typed. Both are destructive and neither is caught by
any test in this repo.
Ruling: hoist the typing guard to the top of the handler, before any key
dispatch, so it covers every shortcut. Space's behaviour is unchanged (it
already returned when typing). Keep the `event.repeat` test scoped to Space --
do NOT hoist that one: holding Ctrl+Z to walk back several edits is normal and
desirable, and a hoisted repeat guard would silently break it.
Cost if wrong: Escape no longer reaches an input to blur it. Trivial next to
losing a segment mid-keystroke.
Task 12: the brief points at "the existing keydown effect, near
src/renderer/ui/Editor.tsx:456". That line number is STALE -- tasks 7 and 8 both
edited above it. The effect is currently at 451-469. Tell the implementer to
locate it by its "Space toggles playback" comment, not by line number.
Task 12: brief step 4 edits HANDOVER.md and the composition spec 13, which is
correct, but the phase E handoff records "Do not merge to main without asking --
that is the user's call, not an agent's". Task 12 ends at a commit on the
branch. The merge is NOT part of this run.

Task 11: PREFLIGHT. Carries session-1 ruling R3, which the brief does not state:
the popover renders INSIDE ZoomLane, positioned with msToPct over the segment's
output span, rather than measuring client rects and portalling to the body. The
brief only says "anchored to the selected segment's region" without saying how.
R3's known cost is that the popover clips at the lane's edges for a segment near
either end, and task 11 was always meant to carry the follow-up to flip it
inward. That follow-up is part of task 11, not a later nicety.
Task 11: consequence of R3 the brief does not mention -- the popover's actions
(setSegmentDepth / setSegmentCamera / deleteSegment / resetSegment) all go
through `edit`, which lives in Editor.tsx, but the popover renders inside
ZoomLane, two components down. Editor -> Timeline -> ZoomLane must thread those
callbacks plus the selected segment and cfg.maxZoom. Say so in the dispatch or
the implementer will discover it halfway and be tempted to portal instead,
silently undoing R3.
Task 11: verified the pieces exist -- depthToScale at keyframes.ts:288;
setSegmentDepth:169, deleteSegment:200, resetSegment:207 in edits.ts; controls.ts
exports sectionHeader, row, buttonInput, fieldLabel. DEPTH_PRESETS is defined
nowhere yet, so task 11 creates it fresh with no duplication risk. The Inspector
section to delete opens at Inspector.tsx:97 ("selected shot"), and its feeding
props (selectedSegment, onSegmentCameraChange) go with it.
Task 11: watch for `waypoints[0].depth` under noUncheckedIndexedAccess -- this
repo has it on (task 5 hit it), so the badge needs a guard. A segment can also
legitimately hold exactly one waypoint after task 4's clipWaypoints keeps the
nearest one; it is never expected to hold zero, but the type does not know that.
Task 11: deleting the Inspector section may leave Editor.tsx's derived
`selectedSegmentId` local with no remaining reader. If so it must go too --
typecheck will say so.

Task 9: spec 11 asks that a segment dragged across a cut be asserted "in both
directions", and the plan's OWN self-review admits task 9 adds no such test,
because the mapping lives in an Editor.tsx callback rather than a pure module.
It names the fix and calls it cheap: extract to a pure
segmentDragToSource(project, id, ..., durationMs) in edits.ts and test that.
The spec is binding and the plan concedes the gap, so this is a real
spec-compliance item, not a nicety -- and the absolute-target ruling makes the
callback MORE extractable, not less, since it no longer closes over drag state.
Raising it with task 9's reviewer as a spec item rather than pre-judging it into
the dispatch after the fact.

Task 9: implementer DONE, commit 509de14. typecheck clean, 482/482, build ok,
verify:parity 30/30. tune not re-run (no planner path touched -- correct).
Task 9: task review dispatched (sonnet) over ab92c87..509de14, carrying the
three rulings as the judging standard, the spec-11 both-directions test gap as
an explicit spec item, and the ResizeObserver concern for adjudication.
Task 9: controller's own verification of Ruling 1, done before the review to
avoid taking the riskiest property on trust:
  onSegmentMove(id, T): targetSource = outputToSource(T, ...);
  moveSegment(p, id, targetSource - s.startMs, ...).
  - Applied twice with the same T: after the first, s.startMs == targetSource,
    so the second computes delta 0. No-op. IDEMPOTENT as required.
  - Clamped case: moveSegment clamps to C != targetSource; the next step
    computes targetSource - C, tries again, clamps to C again. Stable, and
    nothing is banked. Dragging back gives targetSource' - C, measured fresh
    from the clamped position. No leap. Both properties hold.
  - The `?? 0` landmine is gone: outputToSource returns a total number, and
    sourceToOutput is no longer called on this path at all.
  - pointercancel is registered to the same handler as pointerup, so it calls
    onCommit(). A browser-abandoned drag cannot leave gestureOpen true, which
    would otherwise swallow every later edit into one history entry.
  - useRegionDrag's `region.parentElement` assumption holds: SegmentRegion
    returns the region div with no wrapper, mapped directly into the lane's
    position:relative container, so parentElement IS the track.
  - Rulings 2 and 3 both visibly applied -- select never toggles off, and the
    stopPropagation comment now says plainly that it guards nothing today.

Task 9: CARRY TO TASK 10 -- useRegionDrag captures opts.outputDurationMs into
its pointermove closure at pointerdown, and every later px->ms conversion in
that gesture uses the captured value. Harmless for ZOOM segments: moving or
resizing a segment does not change output duration. NOT harmless for CUTS,
which is the whole of task 10. Growing a cut shrinks outputDurationMs, so the
entire timeline rescales under the pointer mid-drag while the hook keeps
converting against the pre-drag duration -- the region will drift away from the
cursor, worse the longer the drag. `startOutputMs`, captured once at
pointerdown, goes stale the same way.
This is not a task 9 defect (the hook is correct for its only current caller);
it is a landmine that arms itself the moment task 10 reuses the hook, exactly
like the addCut/migrate pointers already carried. Task 10's dispatch must
carry it, and task 10 must decide the fix -- read outputDurationMs live from a
ref rather than the pointerdown closure, or have the cut callbacks work in a
coordinate that a cut edit does not move.
Task 9: task review verdict SPEC NONCOMPLIANT / NEEDS FIXES. 0 critical,
2 important, 1 minor. Reviewer independently re-derived Ruling 1's clamp
algebra from the diff (moveSegment computes clamp(lo, hi, s.startMs + delta),
and delta = targetSource - s.startMs collapses to clamp(lo, hi, targetSource)
regardless of current position) and confirmed idempotence and no clamp-banking.
Rulings 2 and 3 verified applied. Pointercancel commit path confirmed. So both
findings are outside the drag logic, which is the hard part and is correct.
  important 1: spec 11 is UNMET -- no both-directions test for the cross-cut
    mapping. Confirmed genuinely absent, not merely foreseen: edits.test.ts has
    no cut-crossing case and timeline.test.ts only round-trips the generic
    mappers. The glue lives in Editor.tsx inline closures the vitest suite
    cannot reach.
  important 2: one ResizeObserver PER SEGMENT in ZoomLane where one on the
    track would do. The implementer raised this itself; the reviewer agreed and
    gave the percentage-derived formula that removes the need entirely.
No ruling required on either -- neither contradicts the plan. Finding 1 is the
fix the plan's OWN self-review already prescribes, so implementing it follows
the plan rather than departing from it.
Task 9: fix round 1/5 dispatched -- resumed the original implementer (context
intact, agent afd5f1c). Findings sent verbatim with the extraction target named
(pure segmentDragToSource in edits.ts, move AND per-edge resize paths) and the
both-directions assertion spelled out, since a single-direction test is exactly
what would miss spec 7's independent-edge mapping. FIX_BASE 509de14.
Task 9: fix round 1/5 -- the session hit its usage limit and KILLED the resumed
implementer mid-flight, at "Build succeeds. Now let's stage, append the fix
report, and commit." Same failure shape as session 1's task 7. Checked rather
than assumed: the fix report WAS appended and all four files were written, but
nothing was staged or committed.
Controller verified the work rather than discarding it, and ran the gates:
  - segmentDragToSource / segmentResizeToSource added to edits.ts as pure
    functions; Editor.tsx's two closures now just call them.
  - 5 new tests. Controller re-derived all four cut-crossing cases by hand
    against outputToSource/sourceSpanToOutput rather than trusting them:
      cut [8000,10000]; seg [2000,5000] dragged to output 9000
        -> outputToSource(9000) = 11000, delta 9000, seg [11000,14000],
           and sourceSpanToOutput back = {9000,12000}. Output duration 3000
           before and after -- source duration also 3000 here because the
           segment lands wholly past the cut, and the OUTPUT target is
           recovered exactly. Correct.
      the reverse drag [11000,14000] -> output 2000 recovers [2000,5000] and
        maps back to {2000,5000}. That is the both-directions pair spec 11 asks
        for, across the same cut.
      resize start [11000,16000] -> output 7000: startMs 7000, endMs untouched.
      resize end [2000,7000] -> output 12000: endMs 14000 (crosses the cut and
        gains the 2000), startMs untouched. That is spec 7's independent-edge
        property asserted per edge.
  - ResizeObserver: now ONE on the lane track with disconnect preserved;
    per-region width derived from trackWidthPx and the same percentages the
    region is positioned with. SegmentRegion's ref/state/observer all gone.
Gates run by controller: typecheck silent; 487 tests / 50 files (was 482, +5);
build 3 bundles. Committed as e31832c.
Task 9: fix round 1/5 (2 addressed, 0 open; commits 509de14..e31832c).
Task 9: scoped re-review dispatched (sonnet) over 509de14..e31832c.
Task 9: the first scoped re-review agent STALLED (watchdog, no progress 600s) --
infrastructure failure, not a verdict. Re-dispatched (sonnet) over the same
range with a tighter, more prescriptive scope: named the exact three files to
read and forbade wider exploration, since the stall looked like unbounded
searching. No finding was adjudicated on the strength of the stall.
Task 9: re-review -- BOTH FINDINGS ADDRESSED, no new breakage. The first two
sonnet re-reviewers stalled on the watchdog (600s each, environment degraded
under the usage limit); the third, on haiku with a fully bounded two-file task,
completed in 105s. Lesson for the rest of this run: under a degraded
environment, give reviewers an explicitly enumerated file list and forbid
searching -- unbounded exploration is what stalls.
Re-reviewer independently re-derived all four cut-crossing cases and got the
same numbers the controller did, and confirmed (a)+(b) are a genuine
left-to-right / right-to-left pair across the SAME cut, and (c)+(d) assert the
untouched edge's source position really is unchanged. ResizeObserver: one
observer, disconnected on unmount, SegmentRegion's ref/state/effect all gone,
and (widthPct/100)*trackWidthPx confirmed arithmetically equivalent to
measuring the rendered region directly.
Task 9: complete (commits ab92c87..e31832c, review clean after 1 fix round)

Task 10: dispatched (sonnet), BASE e31832c. Carries four things the brief does
not say: the outputDurationMs staleness trap, the two verified pointers
(MIN_CUT_MS floor, migrate.ts id collision), task 8's required seam accent, and
the empty-space deselect ruling below.
Task 10: RULING -- add empty-space deselect to the ZOOM lane too, not only the
cut lane. Task 9's ruling removed toggle-off selection from segments on the
grounds that "deselection belongs to a click on empty lane space, which Task 10
already specifies". But task 10's brief specifies it for the CUT lane only. Left
as written, a selected segment could only be deselected by clicking empty space
in a DIFFERENT lane, which is not discoverable. Three lines in ZoomLane closes
the interaction task 9's ruling promised. Cost if wrong: a little scope beyond
the brief's file list, in a file task 10 is already permitted to touch.
Task 10: FIRST DISPATCH STALLED (watchdog 600s) having produced nothing --
clean tree, no report, no commit. Fourth stall of the session, and a pattern is
now clear: the three stalls were all sonnet agents carrying very long inline
prompts; the one agent that completed under the degraded environment was haiku
with a short prompt and an explicitly enumerated file list.
Ruling: stop inlining rulings into dispatch prompts. Task 10's four rulings,
interfaces, do-not-break list and verification steps are now a FILE --
task-10-rulings.md, 145 lines -- and the dispatch is a short pointer to brief +
rulings + implementer template. This is what the skill's own guidance says to do
anyway ("hand artifacts over as files"); the stalls just made it mandatory.
Re-dispatched (sonnet) with the short prompt, BASE e31832c. Also told to commit
BEFORE writing the report file, since two agents this session died in exactly
that gap.

--- SESSION 3 (2026-09-09, resumed after usage limit) ---
Session 2 died after re-dispatching task 10. Verified rather than assumed:
tree clean at e31832c, no task-10-report.md, no task 10 commit. The second
dispatch produced nothing. Task 10 restarts from BASE e31832c.
Task 10: dispatched (opus) with the short-prompt shape session 2's ruling
prescribed -- pointer to brief + rulings file, an explicitly enumerated
nine-file read list, and an instruction not to explore. Model raised from
sonnet to opus because Ruling 1 is an open design decision (which coordinate
the cut drag works in), not transcription; two sonnet attempts already stalled.
Told to commit BEFORE writing the report, since three agents across two
sessions died in exactly that gap.
Task 10: implementer DONE_WITH_CONCERNS, commit 56ee005. typecheck clean,
510/510 tests over 50 files (+29), build ok, verify:parity 30/30. tune not
re-run (no planner path touched -- correct).
Task 10: Ruling 1 answered by the implementer, and it rejected BOTH directions
the controller offered. The hook no longer carries a time unit at all: drag
callbacks report a lane FRACTION, ZoomLane multiplies it back to output ms,
CutLane solves in closed form for the geometry that holds AFTER the rescale
the edit causes. Its argument against (a) is stronger than the staleness the
controller named -- it claims (a) converges on a WRONG length, because the
region's drawn right edge is not the output image of the cut's end, so the
round trip through outputToSource is broken however fresh the scale is. Task 9's
absolute-target principle survives; its unit does not. Sent to the reviewer to
re-derive rather than accepted on the report's say-so.
Task 10: three concerns carried into the review rather than pre-judged --
(1) step 5 hand-verification genuinely not done, no .tsx is under test;
(2) an end-edge drag cannot grow a cut past (D-s)/2, claimed an honest
consequence of Ruling 3's width-bearing region rather than a clamp;
(3) duplicate EXPLICIT cut ids still survive migration (Ruling 2(ii) scoped the
fix to the fallback, so this is within scope as written).
Task 10: task review dispatched (opus) over e31832c..56ee005. Model raised for
the review too: the diff is 60KB, changes a shared hook's callback contract and
a shared geometry signature, and turns on algebra the reviewer was told to
re-derive rather than accept.
Task 10: task review verdict SPEC COMPLIANT / APPROVED. 0 critical,
1 important, 7 minor, 2 cannot-verify. The reviewer independently re-derived
BOTH closed forms against CutLane's actual drawing, the divergence
counter-example against option (a) (100->550->775->887.5->1000 for a correct
answer of 333.3), the monotonicity derivative and the migrate fixed-point
argument, and got the implementer's numbers each time. It also verified a
merge-safety property NEITHER the controller nor the implementer had named:
moveCut/resizeCut pass preferId=id into normalizeCuts, whose preferId branch
keeps the dragged cut's id, so key={c.id} survives a merge, the region does not
unmount mid-gesture, and onCommit is not lost. The self-correcting-overshoot
claim depends on exactly that and it holds.
Task 10: cannot-verify 2 RESOLVED by the controller. `npm run tune -- all` was
missing from the report's verification table and is a global constraint.
Ran it: 148 lines, md5 0b48e73fd9719c2dce45316c6fd23348 -- byte-identical to
the Task 1 baseline in this ledger's header. Note: scratchpad/tune-baseline.txt
had been destroyed (git-ignored scratch, lost between sessions); only the md5
in this ledger survived, which is what made the comparison possible at all.
Baseline file regenerated from this run for tasks 11-12.
Task 10: cannot-verify 1 and the single Important finding are the SAME item --
brief step 5, "verify by hand", not performed.
Task 10: RULING -- park step 5, do not spend fix rounds on it. It is real,
plan-mandated, and the only possible verification of the entire pointer layer
(no .tsx in this repo is reached by any test). But no implementer subagent can
discharge it: it needs a human driving an Electron GUI on Windows. Sending it
into the fix loop would burn rounds on something no round can close. Parked,
carried to the user as an outstanding gate, and it must be closed before
phase E lands. Cost if wrong: the create/move/resize/merge/cancel gestures ship
on reading alone.
Task 10: minor (deferred): CutLane.tsx:228-231 comment and report self-review
item 3 both assert something FALSE about the history layer -- they claim
edit.apply pushes even on a no-op, but history.ts:24 opens push with a deep
same() compare and drops it. The guard is harmless; the comment will mislead.
Task 10: minor (deferred): edits.test.ts:441-450 mirrors CutLane.tsx:52-53 by
hand, and that mirror is the ONLY guard on the acceptance property -- it keeps
passing if the lane's layout changes. Extracting one shared span->fractions
function would make the property load-bearing.
Task 10: minor (deferred): CutLane.tsx:190 / ZoomLane.tsx:169 do not filter
e.button, so a right- or middle-button drag now authors a destructive edit.
Repo-wide pattern (no button check anywhere in src/renderer/), but the
consequence is newly destructive here -- the same gesture previously scrubbed.
Task 10: minor (deferred): useRegionDrag.ts:66 writes optsRef.current during
render; useLayoutEffect is strictly safer at no cost.
Task 10: minor (deferred): duplicated 12-line ResizeObserver + background-
deselect across CutLane and ZoomLane; a useTrackWidth() hook is the natural home.
Task 10: minor (deferred): migrate.ts:56-70 still admits duplicate EXPLICIT cut
ids. Compliant -- Ruling 2(ii) scoped the fix to the fallback and asked for it
small -- and disclosed. Final review to triage whether to widen it.
Task 10: minor (deferred): ZoomLane.tsx:169's e.target===e.currentTarget guard
means a press on a keyframe marker neither selects nor deselects. Confirm during
the hand check.
Task 10: complete (commits e31832c..56ee005, review clean, 1 parked)

Task 11: dispatched (sonnet), BASE 56ee005. Same short-prompt shape: brief
pointer, seven-file read list, verified interfaces inline so it does not hunt.
Sonnet rather than opus -- the brief carries the layout, the exact preset
fractions and the wiring code, so this is transcription plus integration, not
an open design decision the way task 10's Ruling 1 was.
Carried three things the brief cannot know: task 10 changed useRegionDrag's
callbacks to fractions and renamed pxToMs->pxToFrac (so any anchoring reads
current code, not the older shape); task 10 added empty-space deselect to both
lanes, which the popover's outside-pointerdown dismissal must not fight; and
"moved, not duplicated" means the inspector's props must be removed, not
orphaned. Also told it up front that no .tsx is under test, so it puts its test
effort on the pure preset-matching logic (0.001 tolerance) instead of claiming
coverage it cannot have.
Task 11: implementer DONE, commit aa83f7e. typecheck clean, 517/517 over 51
files (+7), build ok. tune/parity not re-run by the implementer (no planner or
renderer path touched) -- controller re-runs both in task 12's gate.
Task 11: implementer added a file beyond the brief's list --
segmentDepthPresets.ts + .test.ts, holding DEPTH_PRESETS and a pure
activeDepthPresetIndex(depth) with the 0.001 tolerance, so the one piece of
testable logic in a task that is otherwise all .tsx is actually tested.
SegmentPopover.tsx re-exports DEPTH_PRESETS so the brief's stated "Produces"
interface still resolves literally. Sent to the reviewer to judge as a possible
Extra rather than pre-approved.
Task 11: task review dispatched (sonnet) over 56ee005..aa83f7e, carrying the
"moved, not duplicated" requirement as a binding constraint, the extra-file
question, and ONE named cross-file risk: the popover anchors by mirroring
ZoomLane's own msToPct left formula rather than measuring the DOM, so the two
formulas must actually agree.
Task 11: task review verdict SPEC COMPLIANT / APPROVED. 0 critical, 0 important,
2 minor, 1 cannot-verify. The reviewer chased the one named risk properly rather
than eyeballing it: Editor.tsx:110 and ZoomLane.tsx:189 call sourceSpanToOutput
with identical argument order from identical sources, and leftPct uses the same
outDuration passed to <Timeline>, so the anchor formulas are genuinely the same
expression, not merely similar. It also traced the outside-pointerdown handler
end to end and confirmed it cannot race task 9/10's selection state. The extra
file (segmentDepthPresets.ts) was judged justified, not scope creep.
Task 11: minor (deferred): the report calls the popover's horizontal alignment
"exact"; it is exact in FORMULA but leftPct is measured against
timelineWrapRef's box while SegmentRegion positions against trackRef's box,
which carries a 1px border a level deeper. Sub-2px, invisible -- but the report
overstates it, and a later reader may rely on the word.
Task 11: minor (deferred): onDismiss is a fresh inline arrow each Editor render,
so the window-listener useEffect detaches and reattaches every render. Harmless;
useCallback at the call site settles it.
Task 11: cannot-verify -- verify:parity and tune -- all not run by the
implementer. Not resolved here by design: task 12's Step 3 IS the full gate run
for the phase and runs both, so closing it twice would waste a real capture run.
Carried into task 12's dispatch as a must-not-skip.
Task 11: complete (commits 56ee005..aa83f7e, review clean)

Task 12: dispatched (sonnet), BASE aa83f7e. Final task. Carried: task 11's
SegmentPopover already dismisses on Escape via its own window listener, so the
new Escape handler must not fight it; the tune baseline's exact path and md5,
with an instruction to DIFF against the file and report the hash rather than
eyeball the output; and an explicit "do not skip or abbreviate" on the seven-
command gate, since verify:capture and verify:decode are slow and touch real
hardware and are exactly the ones an agent is tempted to drop.
Task 12: RULING -- the phase's unverified pointer layer must be written into
HANDOVER.md, not left in this ledger. The SDD workspace is deleted when the
final review is clean, so a parked finding recorded only here dies with it.
Tasks 10, 11 and 12 all skipped their "verify by hand" step for the same
reason (no agent in this run can launch Electron), and that is now a phase-level
gap, not three task-level ones. Task 12's dispatch carries the exact checklist
a human must exercise -- cut create/move/merge/end-edge-limit, segment drag and
resize across a cut, popover depth presets and reset-to-auto, and that Ctrl+Z
undoes a whole drag in one press. Cost if wrong: phase E ships on reading alone
and the handover does not say so.
Task 12: implementer DONE, commit 5b73e0a. ALL SEVEN GATES PASS: 517/517 tests,
typecheck silent, build clean, decode 6/6 k=0, parity 30/30, capture ddagrab
57.70fps (no gdigrab fallback), tune 148 lines md5
0b48e73fd9719c2dce45316c6fd23348 -- byte-identical to the Task 1 baseline.
That closes task 11's cannot-verify item as well.
Task 12: HANDOVER.md verified by the controller to actually carry the gap --
"Phase E's entire pointer/UI layer has never been run" at line 214, referenced
from the summary at line 37. The ruling held.
Task 12: implementer raised one item for adjudication rather than silently
widening scope -- the brief's verbatim code adds NO typing guard to the
Ctrl+Z / Delete / Backspace / Escape branches, while the pre-existing Space
branch in the same listener has one, and the new branches run BEFORE it.
Controller checked the hazard is real rather than theoretical: Inspector.tsx
has numberInput fields at :131 and :183 and StylePanel.tsx a textInput at :171,
so Backspace while editing a number with a shot selected deletes the shot, and
Ctrl+Z in a field preventDefaults the native text undo and undoes a project
edit instead. Not adjudicated by the controller -- handed to task 12's reviewer
by name, with the explicit note that the brief mandating the code does not
settle it. Severity is the reviewer's to assign.
Task 12: task review dispatched (sonnet) over aa83f7e..5b73e0a, also asked to
judge whether the HANDOVER text is specific or self-congratulatory, since it is
the document the next session starts from.
Task 12: task review verdict SPEC COMPLIANT / NEEDS FIXES. 0 critical,
1 important (plan-mandated), 2 minor. The reviewer verified the hard parts by
source-level tracing rather than assertion: the editRef idiom is a genuine
match for useProjectHistory's own ctxRef/onProjectRef pattern; undo really does
restore a deleted item SELECTED, because step() captures h.present.selection
into the past entry BEFORE the handler's own select(null) runs as a second
setHistory; the Escape double-fire is a no-op, not a race, since select()
replaces present.selection in place. It also independently re-derived the tune
md5 against the baseline file rather than trusting the report.
Task 12: RULING -- fix the missing typing guard, do not park it. The brief
supplied the offending code verbatim, so this is a finding against plan text and
mine to rule on. The spec is the binding authority and nothing in it asks for a
destructive shortcut that fires while the user is typing; the same listener
already guards Space that way, so the omission reads as an oversight in the
brief's sketch, not a considered decision. The reviewer established the hazard
is a routine workflow, not an edge case: select a shot, click into the
Inspector's "min hold (ms)" field to correct a value, press Backspace --
preventDefault suppresses the text edit AND deleteSegment fires on the still-
selected shot. Silent data loss with no confirmation. Cost if wrong: a few lines
beyond the brief's literal text, in the file the task already owns.
Task 12: fix round 1/5 dispatched -- resumed the original implementer (context
intact). Findings sent verbatim. Scope: the Important finding, plus ONE bundled
minor (design doc 13's phase-E row omits the keyboard shortcuts that
HANDOVER's row lists) -- bundled deliberately because it is a one-line accuracy
fix to a doc this same task authored, and the alternative is that it dies with
this workspace. Labeled as bundled so the re-review sees it as in scope.
FIX_BASE 5b73e0a.
Task 12: fix round 1/5 -- implementer DONE, commit 5adbff6. Hoisted the Space
branch's typing check into a shared isTypingTarget(), guarded Ctrl/Cmd+Z and
Delete/Backspace with it, left Escape unguarded (non-destructive, does not touch
field state) with the reasoning in a code comment. Design doc 13 row now lists
the shortcuts. 517/517, typecheck silent, build clean. decode/parity/capture/
tune deliberately NOT re-run -- the controller instructed that, nothing in the
fix diff touches those paths, and their 5b73e0a results stand.
Task 12: fix round 1/5 (2 addressed claimed, 0 open; commits 5b73e0a..5adbff6).
Task 12: scoped re-review dispatched (haiku) over 5b73e0a..5adbff6. Haiku with
a fully bounded scope, per session 2's lesson that the one reviewer to complete
under a degraded environment was haiku with a short prompt and an enumerated
task. Gave it five concrete checks rather than "verify the fix", the sharpest
being: does the guard return BEFORE preventDefault, so the native text edit
actually survives? A guard placed after preventDefault would stop the deletion
but still swallow the keystroke -- still broken, and it would pass a careless
read.
Task 12: re-review -- ALL FINDINGS ADDRESSED, no new breakage. The re-reviewer
checked all five named points and reported each. The sharp one holds:
isTypingTarget is ONE definition (Editor.tsx:62-68), computed once into `typing`
at the top of onKey (:95), and both guards sit on the line immediately AFTER
their branch condition and BEFORE preventDefault (Ctrl+Z guard :98 / pD :99;
Delete guard :106 / pD :109), so the native text edit genuinely survives. The
Space branch is semantically unchanged -- only the source of its boolean moved.
Escape's decision is stated in a comment at :119-126.
Task 12: minor (deferred): no automated coverage for the shortcut branches.
Correctly not overclaimed by the implementer; inherent to the no-React-harness
constraint.
Task 12: complete (commits aa83f7e..5adbff6, review clean after 1 fix round)

ALL 12 TASKS COMPLETE. Final whole-branch review next, over 0f9c5e8..5adbff6.
FINAL: whole-branch review dispatched (opus) over 0f9c5e8..5adbff6 -- 16
commits, 193KB. Pointed at the spec as binding authority, at
deferred-and-parked.md (the 20 deferred minors and 1 parked finding, extracted
from this ledger so they survive its deletion), and given the no-React-harness
gap as context it must WEIGH rather than re-litigate. The question put to it
that no per-task review could answer: given no .tsx is testable, is the
untestable component surface as thin as it could be, or is there logic still
trapped in components that should have been extracted into the pure modules
and tested? Also asked whether twelve sequential commits read as one design or
as five opinions about the same problem.

FINAL: whole-branch review verdict MERGE AFTER FIXES. 0 critical, 5 important,
~14 minor. Reviewer read the 5018-line diff in four passes and re-derived task
10's closed forms independently -- both hold, including that f=1 yields exactly
the (D-s)/2 growth limit the doc comment claims.
FINAL: the review found a REAL DEFECT no per-task review could see --
history.ts:56-62, beginOrExtend sets gestureOpen=true even when push() declined
a no-op first step, so a drag whose FIRST pointermove changes nothing records no
history entry at all, overwrites the pre-drag project, and the next Ctrl+Z jumps
back past both the drag and the edit before it. Reachable by an ordinary
gesture: push a segment against its clamp and drag it back. Note this is the
exact failure mode the session-2 task-9 ruling NAMED while rejecting a different
design -- and the shipped design has it too. Fourth time this codebase has been
bitten by something a ruling already described.
FINAL: RULING (Important 2) -- implement spec 7, do not amend it. Segment move
holds SOURCE duration; 7 mandates OUTPUT. The divergence has no recorded
rationale anywhere in the branch, and the mandated test at edits.test.ts:247
lands the segment clear of the cut on both sides -- the ONE configuration where
both implementations agree -- so it asserts the spec's words while exercising
the code's behaviour and would pass either way. Fix the code, and rewrite the
test around a segment that actually straddles the cut. Cost if wrong: a
behaviour change to segment drag late in the phase, in a path with pure-module
tests to catch it.
FINAL: RULING (Important 3) -- banner the stale phase-e-handoff doc, do not
delete it. It currently tells a reader to `git checkout -- Editor.tsx` and `rm
useProjectHistory.ts`, which today destroys tasks 7-12. But it also records how
the phase actually went, including two usage-limit deaths. A banner fixes the
hazard; deletion throws away the record to do it. Cost if wrong: one stale
document carrying a correct warning.
FINAL: RULING (Important 4) -- copy the ledger into docs/ and repoint, do not
just drop the dangling reference. HANDOVER.md:39 cites this progress.md as the
authority for "every ruling made without the user in the room", and .superpowers
is gitignored, so the file reaches no commit and dies with this workspace.
Dropping the reference satisfies the finding's letter while losing precisely
what it is about. Copy to docs/superpowers/plans/2026-09-09-phase-e-ledger.md.
Cost if wrong: one committed document of process history.
FINAL: fix wave dispatched (opus) -- ONE agent, all 5 important findings plus
the 5 deferred minors the review triaged as fix-before-merge, plus 2 minors
folded in free because the fix already opens their files (the same() comment in
history.ts, the duplicated ResizeObserver). Findings handed over as a file
(final-findings.md, 200 lines) carrying the three rulings inline, not pasted
into the prompt. FIX_BASE 5adbff6.
