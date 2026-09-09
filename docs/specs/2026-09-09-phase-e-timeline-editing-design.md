# Phase E — timeline editing: draggable segments, per-shot controls, real cuts, undo/redo

**Written 2026-09-09.** Implements §11 of
`2026-09-04-composition-and-camera-design.md`, which is the whole of phase E in
that spec's phase table. Read alongside §6 (data model) and v1 §6, which is
where "undo/redo is immutable snapshots of the project object, capped at 100
entries" comes from.

Recordly v1.4.0 (`github.com/webadderallorg/Recordly`, AGPLv3 — read for ideas,
no code copied) was read for this design the way it was read for the camera
work. Four of its decisions are adopted and five are deliberately not; §10
lists both, with the reason in each direction.

## 1. What this phase is

Today the timeline is a read-only picture with one interaction: scrub. Segments
can be selected and switched between `fixed` and `follow`; nothing else about a
shot is editable, and a cut is created by a placeholder "cut 0.5s here" button
that cannot be adjusted or removed. This phase makes the timeline the place
where the take is edited:

- zoom segments drag to move and resize from either edge
- a per-segment popover sets depth and camera, and can delete or reset the shot
- cuts become real regions, created by dragging, adjustable and deletable
- every edit is undoable

Phase G revamps this surface. Phase E settles what the surface has to present.

## 2. Decisions

Each of these was a genuine fork. They are recorded with their reason so the
next person does not silently re-open them.

### 2.1 Editing a segment pins it

A dragged, resized or re-depthed segment gets `pinned: true`, and
`replanSegments` then keeps it wholesale. Its times, depth and waypoints stop
being regenerated.

The alternatives were a per-field override map and switching the project to a
manual mode that stops the planner entirely. Pinning wins because the machinery
exists and is tested, and because the cost is bounded: a pinned shot stops
responding to pacing dials, which is what "I have taken ownership of this shot"
should mean. **Reset to auto** (§8) is the escape hatch that makes it
recoverable, and it is not optional — without it, pinning is a one-way door.

Switching a shot's camera between `fixed` and `follow` continues **not** to
pin. That is deliberate and predates this phase; `replanSegments` carries the
choice across by id precisely so a shot can be re-aimed without freezing its
times.

### 2.2 Segments may not overlap

A drag or resize that would make two segments overlap **stops at the
neighbour's edge** rather than passing through it. Segments therefore cannot be
reordered by dragging one past another; moving a shot across its neighbour
means deleting it and letting the planner rebuild, or dragging the neighbour
out of the way first.

Recordly rejects the whole drop instead, with a "Cannot place zoom here"
message. Stopping is chosen over rejecting for consistency with §2.3: one rule
for what a constrained drag does, felt in the edge rather than explained in a
toast.

This is not a tidiness rule. `replanSegments` already documents why overlapping
segments are incoherent — they "emit keyframes competing with the kept one's
for the same instants, and the camera would be told two things at once." The
planner has never produced an overlap, so the invariant has held by accident.
Dragging is the first thing that can break it.

### 2.3 A segment has a floor of `zoomInOverlapMs + transitionOutMs`

The camera settles `zoomInOverlapMs` (500ms) after a segment starts and pulls
out over `transitionOutMs` (1000ms). A shot shorter than their sum has no hold
in it at all: it arrives and immediately leaves, which is the flinch
`applySegmentGuards` exists to prevent.

So the resize edge **stops** at that floor. The cursor keeps moving, the edge
does not, the way a clip cannot be dragged past zero length. Nothing invalid
can be authored, and the constraint is felt rather than explained.

The floor is derived from the live `ZoomConfig`, not a constant. A user who
lowers `transitionOutMs` has earned a shorter floor.

### 2.4 Depth is six discrete presets

`ZoomWaypoint.depth` stays a 0..1 float — it must, because it is relative to a
ceiling that moves with the output aspect, which is the whole reason
`depthToScale` exists. The **control** is six buttons, not a slider:

| preset | depth | label at `maxZoom` 2.0 |
| --- | --- | --- |
| 1 | 0.25 | 1.25× |
| 2 | 0.40 | 1.40× |
| 3 | 0.55 | 1.55× |
| 4 | 0.70 | 1.70× |
| 5 | 0.85 | 1.85× |
| 6 | 1.00 | 2.00× |

Labels are computed through `depthToScale(depth, ceiling)` at render time, so
they follow `maxZoom` instead of lying about it.

Discrete beats continuous because two shots set to the same preset match
*exactly*. A slider gives 1.83× against 1.84× with no way to make them agree,
and "make these two zooms the same" is a thing people want. Setting a depth
writes it to **every waypoint in the segment** — a travelling shot holds one
depth and pans; varying depth across waypoints is not a thing this phase
exposes.

An auto-planned segment usually sits between presets: the planner's intents are
0.917 (click), 0.583 (typing) and 0.25 (scroll). No button is active in that
case, and the badge shows the resolved `×`. That is honest — the shot has a
planned depth, and pressing a preset overrides it.

### 2.5 Undo/redo snapshots the whole project, and includes selection

Snapshots are whole `Project` objects, capped at 100. Keyframes are derived and
live inside `Project`, so a whole-project snapshot restores them for free; a
snapshot of just the segments would have to re-derive on undo, and re-deriving
is what the phase is trying to make explicit rather than implicit.

Snapshots carry the selection too (§2.6). Undoing a delete must bring the
segment back selected, or undo has restored the data and lost the user's place.
The playhead is **not** in the snapshot: it is where you are looking, not what
you made.

A no-op records nothing. A drag that ends where it started, or a preset press
that re-selects the current depth, must not consume an undo slot.

### 2.6 Cuts get ids, and selection becomes one field

`Cut` is `{ startMs, endMs }` — no identity. That is fine while the only
operation is "append one", and breaks the moment a cut can be dragged:
`normalizeCuts` sorts and **merges** its input, so a cut's array index is not
stable across the very function every cut edit routes through. A gesture
addressing `cuts[2]` can find itself moving `cuts[1]` mid-drag, having merged.

So `Cut` gains an `id`, matching `ZoomSegment`, and every cut operation
addresses by id:

```ts
export type Cut = { id: string; startMs: number; endMs: number };
```

When `normalizeCuts` merges two cuts it keeps the **earlier** cut's id by
default, but takes an optional `preferId` so a drag can insist its own cut is
the survivor. Without that, dragging cut B onto cut A destroys B mid-gesture
and the drag is left addressing a cut that no longer exists. `migrate.ts`
already handles project-shape changes; a cut without an id gets one there. This
does not bump `version`, which is reserved for changes that cannot be repaired
on load.

Selection likewise stops being segment-only, since §9 lets `Delete` remove
either kind:

```ts
type Selection = { kind: "segment" | "cut"; id: string } | null;
```

This replaces `selectedSegmentId` in `Editor.tsx` and is what §2.5 puts in the
snapshot.

## 3. The `applyPlan` split

`Editor.applyPlan` currently fuses two operations and every handler calls the
whole thing:

1. **re-plan** — `planZoom(telemetry, config, ctx)` then `replanSegments` merge,
   producing segments
2. **derive** — `segmentsToKeyframes(segments, config, ctx, cameraPath)` then
   `replan` merge, producing keyframes

Phase E has to separate them, because a segment edit needs only the second.
Re-planning after a drag would walk the whole telemetry array on every commit,
and — worse — would re-derive every *other* segment, so dragging one shot could
move its neighbours.

They become two functions with the same context builder behind them:

```ts
replanFrom(config, project)      // telemetry -> segments -> keyframes
deriveKeyframes(config, project) // segments  -> keyframes
```

| caller | which |
| --- | --- |
| load, `onConfigChange`, `onOutputChange` | `replanFrom` |
| every `edits.ts` operation | `deriveKeyframes` |
| reset to auto | `replanFrom`, after unpinning |

This is the seam the rest of the phase hangs off, and it should land first.

## 4. `src/shared/project/edits.ts`

New, pure, `Project → Project`, no React. Every timeline mutation goes through
one of these; they own the invariants from §2.

| operation | invariants applied |
| --- | --- |
| `moveSegment(p, id, deltaMs)` | clamp to `[0, duration]`, stop at neighbours (§2.2), pin |
| `resizeSegment(p, id, edge, tMs)` | floor (§2.3), stop at neighbour, pin |
| `setSegmentDepth(p, id, depth)` | write to every waypoint, pin |
| `setSegmentCamera(p, id, position)` | **no pin** (§2.1) |
| `deleteSegment(p, id)` | — |
| `resetSegment(p, id)` | clears `pinned`; caller re-plans |
| `addCut(p, startMs, endMs)` | `normalizeCuts`; returns the new id |
| `moveCut(p, id, deltaMs)` | `normalizeCuts` |
| `resizeCut(p, id, edge, tMs)` | `normalizeCuts` |
| `deleteCut(p, id)` | — |

Cut operations route through the existing `normalizeCuts`, which already sorts,
repairs, clamps and merges overlaps. Cuts are allowed to merge on overlap;
segments are not allowed to overlap at all. The asymmetry is intended — two
adjacent cuts are one longer cut, but two overlapping zooms are a contradiction.

Purity is the point: the floor, the neighbour clamping and the cut merging are
unit-testable with no DOM, which is the same shape `cuts.ts` and `timeline.ts`
already have.

## 5. `src/shared/project/history.ts`

```ts
type Entry = { project: Project; selection: Selection };
type History = {
  past: Entry[];
  present: Entry;
  future: Entry[];
  /** Open while a drag is in flight; see the gesture rules below. */
  gestureOpen: boolean;
};

push(h, next): History        // no-op if deep-equal to present; caps past at 100
beginOrExtend(h, next)        // pushes on the first call, replaces after
commit(h): History            // closes the gesture, unwinding a no-op
undo(h): History
redo(h): History
```

Pure, no React, cap 100 per v1 §6. `push` compares against `present` and
returns the history unchanged when they match (§2.5). `gestureOpen` lives in
the pure module rather than in a hook ref so the drag rules below are testable
without a DOM.

**One drag is one entry.** The pointerdown captures nothing; pointermove
updates the project *without* pushing; pointerup pushes once. Recordly gets
this for free by using a drag library that commits spans only on drop — we get
it by pushing explicitly at the end of the gesture, which is the same
guarantee without the dependency.

### The mutation seam

`useProjectHistory` in the renderer wraps `useState<History>` and exposes:

```ts
apply(fn: (p: Project) => Project): void      // edits present AND pushes
applyTransient(fn: (p: Project) => Project)   // edits present, pushes nothing
commit(): void                                // pushes the present as one entry
```

A click-sized edit — a depth preset, a camera switch, a delete — calls `apply`
and is done. A drag calls `applyTransient` on every pointermove and `commit`
once on pointerup, which is what makes the whole gesture a single entry (§2.5).

The mechanism has one subtlety worth stating, because the obvious reading of
"transient means it does not push" loses the pre-drag state — `present` is
overwritten by the first pointermove and nothing has it any more:

- the **first** `applyTransient` of a gesture pushes the pre-drag `present`
  onto `past`, exactly as `apply` would, and marks the gesture open
- every subsequent `applyTransient` replaces `present` and leaves `past` alone
- `commit` closes the gesture, and pops the entry back off `past` if `present`
  is deep-equal to it — which is how a drag that ends where it started
  consumes no undo slot (§2.5)

So `past` gains one entry at the start of the gesture rather than at its end,
and the entry is removed again if the gesture turned out to be a no-op.

Every handler in `Editor.tsx` routes through one of the three, and
`live.current` is updated in exactly one place inside the hook.

That last part fixes a hazard the file already documents. Today every mutation
hand-patches `live.current` alongside `setProject`, and `Editor.tsx`'s own
comment records what happens when one forgets: `addCut` "patched `live.current`
and never redrew at all, so adding a cut left a stale frame on screen until the
next scrub." Phase E adds eight more mutations to a pattern that has already
failed once.

## 6. Timeline lanes

`Timeline.tsx` keeps the time↔pixel mapping, the footer readout, and a playhead
spanning the stack. Three lanes under it:

```
┌─ ruler ─────────────────────┐  owns scrubbing
│ 0:00    0:05    0:10   0:15 │
├─ zooms ─────────────────────┤  ZoomLane.tsx
│   ▐████▌    ▐██████▌  ▐██▌  │
├─ cuts ──────────────────────┤  CutLane.tsx
│          ▓▓▓          ▓▓▓▓  │
└─────────────────────────────┘
      │ playhead spans all
```

- **Ruler** owns scrubbing. This retires the `stopPropagation` hack: segments
  currently have to cancel the track's own pointerdown to be selectable, and
  adding two more draggable things to that one surface is how boundary picking
  becomes unpredictable.
- **`ZoomLane.tsx`** draws segment regions with the keyframe markers inside
  them. The markers stay inside the region — the existing comment's reasoning
  holds, "the markers of a shot sit inside it" — and `easing === "linear"`
  continues to filter out the follow sampler's picket fence.
- **`CutLane.tsx`** draws cut regions. Dragging empty space here creates a cut,
  which is what finally removes the "cut 0.5s here" button.

### `useRegionDrag.ts`

One hook, used by both lanes: pointer capture, px→ms, and a ~6px edge hit zone
deciding move vs resize. Below a minimum rendered width a region is move-only —
a 1.5s shot on a 90s take is about 12px wide, and if both ends are edges there
is nothing left to grab.

Shared because otherwise each lane reinvents pointer capture and only one of
them handles the cursor leaving the window. The px→ms and hit-zone maths live
in pure helpers next to it, tested without a DOM.

## 7. Coordinates — the trap

**Segments and cuts store source time. The timeline draws output time.**
`sourceSpanToOutput` already does the forward map.

A drag produces a delta in *output* ms. Each edge maps back through
`outputToSource` **independently** rather than applying one delta to both
edges. The consequence is worth stating plainly:

> Dragging a segment across a cut changes its source duration while its output
> duration stays fixed.

That is correct — output time is what a viewer sees, so a shot that looks four
seconds long should stay four seconds long — but it is exactly the class of
off-by-one `cuts.ts` warns about ("that mapping is where off-by-ones live"), so
it is written down rather than left in someone's head. It gets a dedicated test.

A cut cannot be dragged inside another cut; `normalizeCuts` would merge them,
which is the right outcome and needs no special case.

## 8. `SegmentPopover.tsx`

Anchored to the selected segment in the zoom lane; dismissed on Escape, on an
outside click, or on deselect.

```
┌─ shot ────────────── 1.55× ─┐   badge: resolved scale
│ ┌──────────┬──────────────┐ │
│ │  fixed   │    follow    │ │   segmented, with one line
│ └──────────┴──────────────┘ │   of explanation beneath
│ holds this framing          │
│ ┌──┬──┬──┬──┬──┬──┐         │
│ │1.25│1.40│1.55│1.70│1.85│2.00│  six presets, live labels
│ └──┴──┴──┴──┴──┴──┘         │
│ 4.2s · 2 waypoints          │
│ reset to auto      delete   │
└─────────────────────────────┘
```

The layout is Recordly's, which is well judged: the resolved value as a badge
in the header, the mode as a segmented control with a sentence explaining what
it does, the depth grid, destructive action last.

`Inspector.tsx`'s "selected shot" section is **deleted**, not duplicated. The
inspector keeps the ~20 global `ZoomConfig` dials and becomes purely the Global
half of §11's split.

**Reset to auto** clears `pinned` and re-plans, returning the shot to the
planner. §2.1 depends on it existing.

## 9. Keyboard

- `Ctrl+Z` / `Ctrl+Shift+Z` — undo / redo
- `Delete` / `Backspace` — delete the selected segment or cut
- `Escape` — dismiss the popover, then clear selection

`Editor.tsx` already owns a `keydown` listener; these join it.

## 10. Recordly — adopted and rejected

**Adopted:** discrete depth presets (§2.4); the no-overlap invariant (§2.2);
selection inside the history snapshot and the deep-equal no-op guard (§2.5);
the segment panel's content layout (§8).

**Rejected, with reasons:**

- **Their 100ms minimum region length.** `minItemDurationMs` is a flat 100 and
  unrelated to any transition constant. In zoomcast that is precisely the
  flinch the pacing guards exist to prevent — see §2.3.
- **Their `ZoomMode = "auto" | "manual"` naming.** It describes the same
  behaviour our `follow`/`fixed` does, but zoomcast already spends
  `"auto" | "manual"` on `origin`, which is provenance. Adopting it would give
  us `mode: "manual"` and `origin: "manual"` meaning unrelated things.
- **Their region-only history.** `EditorHistorySnapshot` holds regions and
  captions but no style or output settings, so changing the background is not
  undoable there. Ours are derived-keyframe-bearing whole projects — see §2.5.
- **Their one-shot auto-zoom.** `useFreshRecordingAutoZoom` runs the suggestion
  pass once per fresh recording, skipping any suggestion that overlaps an
  existing region, and never runs again. Simpler than our re-plan-and-merge,
  and genuinely tempting — but it cannot support `npm run tune -- all` or the
  inspector's pacing dials, both of which depend on re-planning an edited
  project. Their reserved-span skip is the same idea as `replanSegments`'
  `clashes()`, which is mild convergent evidence that the merge model is sound.
- **`dnd-timeline`.** It gives them commit-on-drop for free, which is the part
  that makes one drag one history entry. We get the same guarantee by pushing
  at pointerup (§5) without taking a dnd-kit dependency for one timeline.

## 11. Testing

Pure modules carry the load, per §14's existing split:

- `edits.ts` — the floor, neighbour clamping, pinning (and the one operation
  that must *not* pin), depth written to every waypoint, cut normalisation
- `history.ts` — the 100 cap, the no-op guard, undo/redo/undo round trips,
  redo cleared by a new edit, and the gesture rules: many `beginOrExtend` calls
  then one `commit` leave exactly one entry, and a gesture returning to its
  starting state leaves none
- `useRegionDrag` helpers — px→ms, the edge hit zone, the move-only threshold
- the §7 mapping — a segment dragged across a cut, asserted in both directions

Renderer output stays untested per §14 (GPU snapshots are flaky across driver
updates). `verify:parity` must hold at **30/30** — nothing here touches the
renderer — and the planner is untouched, so `npm run tune -- all` needs no new
baseline and any change in its output is a bug in the `applyPlan` split.

## 12. Out of scope

Named so they are not smuggled in:

- waypoint-level editing — dragging a waypoint within a shot
- splitting or merging segments
- creating a zoom segment from scratch on an empty stretch
- multi-select
- timeline zoom/pan (the track is always the whole take)

None are in §11. Each is defensible later; each would widen the phase.
