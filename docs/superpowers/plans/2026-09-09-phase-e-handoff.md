> SUPERSEDED — historical record only. Phase E is code-complete on
> `phase-e-timeline-editing` (tasks 1–12). The recovery steps below would now
> DESTROY tasks 7–12; do not follow them. Current state: `docs/DEVELOPER-GUIDE.md`
> and `HANDOVER.md`. The ledger it cites is archived at
> `docs/superpowers/plans/2026-09-09-phase-e-ledger.md`.

# Handoff — phase E, tasks 1–6 landed, task 7 in flight

**Written 2026-09-09.** Branch **`phase-e-timeline-editing`**, cut from `main`
at `0f9c5e8`. Seven commits on it, tasks 1–6 of a 12-task plan complete and
reviewed. **`main` is untouched and everything on it is pushed.**

## Start here

1. `git status` on `phase-e-timeline-editing`. **There is uncommitted work in
   the tree** — see "Task 7 is half-done" below. Decide whether to keep it
   before doing anything else.
2. Read `.superpowers/sdd/2026-09-09-phase-e-timeline-editing/progress.md`. That
   ledger is the authority on what is done, every ruling made and why, and every
   deferred finding. It outranks this file and it outranks anyone's memory.
3. The plan is `docs/superpowers/plans/2026-09-09-phase-e-timeline-editing.md`,
   the spec it argues from is
   `docs/specs/2026-09-09-phase-e-timeline-editing-design.md`. Read the spec
   when the plan and a reviewer disagree — the spec is binding, the plan is
   argument.

## Task 7 is half-done and NOT committed

The working tree has `src/renderer/ui/useProjectHistory.ts` (new, untracked)
and modifications to `src/renderer/ui/Editor.tsx`. A subagent was mid-task when
the session ended. **No report was written, so nothing about that work has been
verified** — not the tests, not the typecheck, not the build.

Two honest options:

- **Discard and redo.** `git checkout -- src/renderer/ui/Editor.tsx` and
  `rm src/renderer/ui/useProjectHistory.ts`, then re-dispatch task 7 from its
  brief. Cleanest, and task 7 is ~20 minutes of agent time.
- **Inspect and finish.** Read both files against
  `.superpowers/sdd/2026-09-09-phase-e-timeline-editing/task-7-brief.md` and the
  mandatory deviation below, then run the gates yourself.

Prefer discarding unless the diff obviously looks complete. Half-finished work
that typechecks is more dangerous than no work.

## What landed

| Commit | Task | What |
| --- | --- | --- |
| `11fc0df` | 1 | `replanFrom` / `deriveKeyframes` split out of `Editor.applyPlan` |
| `2ffca22` | 2 | `Cut` gains an `id`; `normalizeCuts` gains `preferId` |
| `e96c045` | 3 | `history.ts` — undo/redo with drag-gesture coalescing |
| `5b2c3e6` | 4 | `edits.ts` — segment operations |
| `8584740` | 6 | `timeline/geometry.ts` — pure drag maths |
| `811e67a` | 4 fix | `resizeSegment` drops out-of-bounds waypoints |
| `d86337e` | 5 | `edits.ts` — cut operations |

Tasks ran 1, 2, 3, 4, 6, 5 — 6 was interleaved ahead of 5 deliberately (see
rulings). Every one passed a task review; only task 4 needed a fix round.

**Gates at `d86337e`:** 482 tests / 50 files, typecheck silent, `verify:parity`
30/30, and `tune -- all` byte-identical to the pre-task baseline
(md5 `0b48e73fd9719c2dce45316c6fd23348`). That tune baseline is the guard that
task 1's refactor changed no behaviour; **re-check it after task 7**, since
task 7 rewires every caller.

## The one Critical the reviews caught

Worth reading before touching `edits.ts`, because it is the shape of mistake
this area invites.

`resizeSegment` originally moved a segment's edges and never touched its
waypoints — that is what the plan specified, and it was wrong. Drag an edge
inward past a waypoint and the waypoint is stranded outside `[startMs, endMs]`.
Traced into `segmentsToKeyframes` (`src/shared/zoom/keyframes.ts:78-133`) on the
plan's own test case — segment `[5000, 12000]`, waypoints 5500 and 6500, start
dragged to 10500:

- `i === 0`: the outer `Math.max(w.tMs, …)` clamps to `latestSettleMs` → 6500
- `i === 1`: `settleMs = w.tMs`, unclamped → 6500

Two keyframes at the **identical** timestamp, both before the segment starts.
That is "the camera told two things at once" — the exact failure the no-overlap
invariant exists to prevent — arriving from inside one segment rather than
between two.

Fixed in `811e67a` by **dropping** out-of-range waypoints, not clamping them.
Clamping collapses several waypoints onto one timestamp, which recreates the
crushed-waypoint bug fixed on 2026-09-08 (`minWaypointGapMs: 900` exists at
`src/shared/zoom/config.ts:69` because two waypoints 260ms apart produced a
190px jump in one frame). If dropping would empty the array, the nearest
waypoint is kept and clamped — a segment with no waypoints has no camera target.

## Rulings made on your behalf

Each is in the ledger with its cost-if-wrong. Rework any you disagree with.

1. **Feature branch, not a git worktree.** A worktree needs its own `npm
   install` of 657M including native `uiohook-napi` and Electron 44 across
   `/mnt/c`, which `CLAUDE.md` says to avoid. *Cost: less isolation from your
   own edits to the same tree.*

2. **R1 — the plan's history-cap test asserted the wrong number.** It expected
   `past[0]` at `micGainDb 11`; 110 pushes leave `past` as `e10..e109`, so the
   answer is **10**. The implementation was right and the test was wrong; left
   alone, an executor would have "fixed" working code. *Cost: the cap silently
   retains 99 or 101 entries.*

3. **R2 — `select` must not push a history entry.** The plan's hook code used
   `push`, making every click on a segment its own undo step, so Ctrl+Z would
   walk back through selections instead of edits. Spec §2.5 wants selection to
   *travel inside* snapshots — which still works, because a delete's own
   `apply` captures the selection at the moment of the delete. **This deviation
   is mandatory and task 7 may not have applied it — verify.** *Cost: undo feels
   inert, or a delete's selection is not restored.*

4. **R3 — the segment popover renders inside `ZoomLane`**, positioned with
   `msToPct` over the segment's output span, rather than measuring client rects
   and portalling to the body. The plan said "anchored to the selected segment's
   region" without saying how. *Cost: the popover clips at the lane's edges for
   a segment near either end, and task 11 gains a follow-up to flip it inward.*

5. **Task 6 was interleaved ahead of task 5.** Task 5 appends to
   `edits.ts`/`edits.test.ts` — the files a task 4 fix round would touch — so 4
   and 5 had to serialise; task 6 shares nothing with either. *Cost: none to
   correctness; git order is 4, 6, 5.*

6. **`resizeSegment` drops rather than clamps waypoints** — the Critical above.
   *Cost: dragging an edge past a waypoint loses that waypoint's framing rather
   than sliding it. Recoverable by undo, and reset-to-auto restores planner
   waypoints wholesale.*

7. **A reviewer may run alongside an implementer**, though never two
   implementers. *Cost: a fix round on the reviewed task could collide with the
   parallel implementer's files, so this was only done when the file sets were
   disjoint.*

## Carry these into the tasks that need them

Two deferred findings are **not safe to forget**, because a later task makes
them reachable:

- **→ Task 10.** `addCut` enforces no minimum length of its own; only
  `normalizeCuts`' zero-length filter applies, so a 1–99ms cut is creatable
  despite `MIN_CUT_MS` implying otherwise. Task 10's drag-to-create is the only
  thing that enforces the floor. If it doesn't, sub-minimum cuts become real.
- **→ Task 10.** `migrate.ts`'s `cut-${i}` fallback does not check for collision
  against an explicit `id` already in the array. Not reachable today because
  nothing looks a cut up by id — **task 10 introduces exactly that lookup.**

The other deferred minors are in the ledger and none of them block anything.

## What is left

Tasks 7–12, all briefed at
`.superpowers/sdd/2026-09-09-phase-e-timeline-editing/task-N-brief.md`:

| Task | What | Notes |
| --- | --- | --- |
| 7 | `useProjectHistory` + rewire `Editor.tsx` | in flight, uncommitted; carries R2 |
| 8 | Split the timeline into ruler / zoom / cut lanes | structure only, no dragging |
| 9 | Drag and resize zoom segments | the source↔output mapping trap lives here |
| 10 | Real cut regions, delete the placeholder button | carries both pointers above |
| 11 | The segment popover; delete Inspector's "selected shot" | carries R3 |
| 12 | Keyboard shortcuts, then the full gate run | ends by updating this doc and §13 |

Task 7 is the riskiest and everything else waits on it. Tasks 8–12 are all
prose-described in the plan rather than given as complete code, so they need a
mid-tier model at minimum — the thin briefs (48, 47, 73, 68 lines) are a signal
that the implementer must exercise judgment, not transcribe.

## Things that will bite you

- **The plan's test counts are wrong.** Three times: "12 tests" where there are
  11, "21" where there are 20, "11" where there are 10. The brief's actual
  `it(...)` blocks are truth. Tell every reviewer the real number or it chases a
  phantom missing test.
- **Subagent reports are not evidence.** Task 6's implementer reported its test
  split as "5 / 2 / 3" when the file is "3 / 2 / 5". Harmless there, but had it
  been true the two boundary tests would have been missing. Grep the file.
- **Interleaving breaks the naive re-review base.** Task 6's commit landed
  between task 4 and task 4's fix, so packaging a re-review from "the head the
  previous review saw" would have handed the re-reviewer an already-approved
  diff. Check `git log` before packaging.
- **Everything runs on Windows.** `powershell.exe -NoProfile -Command "cd
  C:\dev\zoomcast; npm test"`. Never `npm` under WSL.
- **Do not merge to `main` without asking.** The plan's task 12 ends with a
  merge and a `HANDOVER.md` update; that is the user's call, not an agent's.

## Gates before any merge

```powershell
cd C:\dev\zoomcast
npm test              # 482 at d86337e, will grow
npm run typecheck     # silent
npm run build         # three bundles
npm run verify:decode # 6/6, k=0
npm run verify:parity # 30/30 -- nothing in phase E touches the renderer
npm run verify:capture # ddagrab at >=50fps
npm run tune -- all   # must stay byte-identical to the baseline
```

The tune baseline for this branch is md5 `0b48e73fd9719c2dce45316c6fd23348`,
148 lines. Phase E does not touch the planner, so **any** change to that output
is a bug, not an improvement.
